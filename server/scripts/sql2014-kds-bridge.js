require('dotenv').config();
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const sql = require('mssql');

const PID_FILE = path.resolve(__dirname, '.sql2014-bridge.pid');

function acquireLock() {
  if (fsSync.existsSync(PID_FILE)) {
    const existingPid = Number(fsSync.readFileSync(PID_FILE, 'utf8').trim());
    try {
      process.kill(existingPid, 0);
      console.error(`[sql2014-bridge] outra instância já está rodando (PID ${existingPid}). Encerrando.`);
      process.exit(1);
    } catch {
      // processo não existe mais, arquivo PID está obsoleto
    }
  }
  fsSync.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function releaseLock() {
  try { fsSync.unlinkSync(PID_FILE); } catch { /* ignorar */ }
}

const POLL_INTERVAL_MS = Number(process.env.SQL2014_POLL_INTERVAL_MS || 3000);
const STATE_FILE = path.resolve(__dirname, process.env.SQL2014_STATE_FILE || '.sql2014-bridge-state.json');
const KDS_API_BASE = String(process.env.KDS_API_BASE || 'http://127.0.0.1:8081').replace(/\/$/, '');
const SQL_QUERY_FILE = process.env.SQL2014_QUERY_FILE ? path.resolve(__dirname, process.env.SQL2014_QUERY_FILE) : null;
const SQL_QUERY = process.env.SQL2014_QUERY || '';
const SQL_STATUS_MODE = String(process.env.SQL2014_STATUS_MODE || 'parity').trim().toLowerCase();

function parseStatusMap(value) {
  const raw = String(value || '').trim();
  const map = {};

  if (!raw) return map;

  for (const pair of raw.split(',')) {
    const [source, target] = pair.split(':').map(part => String(part || '').trim());
    if (!source || !target) continue;
    map[source.toLowerCase()] = target.toLowerCase();
  }

  return map;
}

const STATUS_MAP = parseStatusMap(process.env.SQL2014_STATUS_MAP);

function getEnv(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y';
}

const sqlConfig = {
  server: getEnv('SQL2014_HOST', '127.0.0.1'),
  port: Number(getEnv('SQL2014_PORT', '1433')),
  user: getEnv('SQL2014_USER'),
  password: getEnv('SQL2014_PASSWORD'),
  database: getEnv('SQL2014_DATABASE'),
  options: {
    encrypt: toBool(getEnv('SQL2014_ENCRYPT', 'false')),
    trustServerCertificate: toBool(getEnv('SQL2014_TRUST_CERT', 'true')),
    enableArithAbort: true,
  },
  pool: {
    max: Number(getEnv('SQL2014_POOL_MAX', '10')),
    min: Number(getEnv('SQL2014_POOL_MIN', '0')),
    idleTimeoutMillis: Number(getEnv('SQL2014_POOL_IDLE_TIMEOUT_MS', '30000')),
  },
};

function normalizeStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (!status) return 'received';

  if (STATUS_MAP[status]) {
    return STATUS_MAP[status];
  }

  if (/^[+-]?\d+$/.test(status)) {
    if (SQL_STATUS_MODE === 'parity') {
      const numeric = Math.abs(Number(status));
      return numeric % 2 === 1 ? 'cancelled' : 'received';
    }
  }

  const map = {
    received: 'received',
    recebido: 'received',
    new: 'received',
    preparing: 'preparing',
    preparando: 'preparing',
    in_progress: 'preparing',
    ready: 'ready',
    pronto: 'ready',
    delivered: 'delivered',
    entregue: 'delivered',
    cancelled: 'cancelled',
    cancelado: 'cancelled',
  };

  return map[status] || 'received';
}

function lowerCaseKeys(row) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    normalized[String(key).toLowerCase()] = value;
  }
  return normalized;
}

function parseItems(itemsRaw) {
  if (Array.isArray(itemsRaw)) {
    return itemsRaw
      .map(item => ({
        name: String(item?.name || '').trim(),
        quantity: Number(item?.quantity || 1),
        notes: String(item?.notes || ''),
      }))
      .filter(item => item.name);
  }

  if (typeof itemsRaw === 'string' && itemsRaw.trim()) {
    try {
      const parsed = JSON.parse(itemsRaw);
      return parseItems(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function parseItemFromFlatRow(row) {
  const name = String(
    row.itemname
    || row.produtodescricao
    || row.productname
    || row.productdescription
    || ''
  ).trim();

  if (!name) return null;

  const quantityRaw = row.itemquantity ?? row.qde ?? row.quantity;
  const quantityNumber = Number(quantityRaw || 1);

  return {
    name,
    quantity: Number.isFinite(quantityNumber) && quantityNumber > 0 ? quantityNumber : 1,
    notes: String(row.itemnotes ?? row.observacoes ?? row.notes ?? ''),
  };
}

function groupRowsToOrders(rows) {
  const grouped = new Map();

  for (const rawRow of rows) {
    const row = lowerCaseKeys(rawRow);
    const externalId = String(row.externalid || '').trim();
    if (!externalId) continue;

    const updatedAt = parseUpdatedAt(row.updatedat);
    if (!updatedAt) continue;

    if (!grouped.has(externalId)) {
      grouped.set(externalId, {
        externalId,
        number: row.number,
        customerName: row.customername,
        observations: row.observations,
        status: row.status,
        updatedAt,
        items: [],
        hasActiveItems: false,
        hasCancelledItems: false,
        isOrderCancelled: false,
      });
    }

    const current = grouped.get(externalId);
    if (updatedAt > current.updatedAt) {
      current.updatedAt = updatedAt;
    }

    if (row.status !== undefined && row.status !== null && row.status !== '') {
      current.status = row.status;
      if (normalizeStatus(row.status) === 'cancelled') {
        current.isOrderCancelled = true;
      }
    }

    const itemStatus = normalizeStatus(row.itemstatus ?? row.status);
    if (itemStatus === 'cancelled') {
      current.hasCancelledItems = true;
    } else {
      current.hasActiveItems = true;
    }

    const itemsFromJson = parseItems(row.itemsjson);
    if (itemsFromJson.length) {
      current.items.push(...itemsFromJson);
      continue;
    }

    const itemFromFlatRow = parseItemFromFlatRow(row);
    if (itemFromFlatRow) {
      current.items.push(itemFromFlatRow);
    }
  }

  return Array.from(grouped.values()).map(order => ({
    ...order,
    status: order.isOrderCancelled
      ? 'cancelled'
      : (order.hasActiveItems ? 'received' : (order.hasCancelledItems ? 'cancelled' : normalizeStatus(order.status))),
    items: order.items.length
      ? order.items
      : [{ name: 'Pedido sem itens detalhados', quantity: 1, notes: '' }],
  }));
}

async function loadState() {
  try {
    const content = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(content);
    return {
      lastSyncAt: parsed.lastSyncAt || process.env.SQL2014_INITIAL_SYNC_AT || '1970-01-01T00:00:00.000Z',
      idMap: parsed.idMap || {},
      lastStatusByExternalId: parsed.lastStatusByExternalId || {},
    };
  } catch {
    return {
      lastSyncAt: process.env.SQL2014_INITIAL_SYNC_AT || '1970-01-01T00:00:00.000Z',
      idMap: {},
      lastStatusByExternalId: {},
    };
  }
}

async function saveState(state) {
  const payload = JSON.stringify(state, null, 2);
  await fs.writeFile(STATE_FILE, payload, 'utf8');
}

async function buildQueryText() {
  if (SQL_QUERY_FILE) {
    return fs.readFile(SQL_QUERY_FILE, 'utf8');
  }
  return SQL_QUERY;
}

function buildAuthHeaders() {
  const token = getEnv('KDS_AUTH_TOKEN');
  const user = getEnv('KDS_AUTH_USERNAME');
  const pass = getEnv('KDS_AUTH_PASSWORD');

  if (token) {
    return { Authorization: `Bearer ${token}` };
  }

  if (user && pass) {
    const encoded = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  return {};
}

async function callKdsApi(pathname, init = {}) {
  const url = `${KDS_API_BASE}${pathname}`;
  const headers = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(),
    ...(init.headers || {}),
  };

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`KDS API ${response.status} at ${pathname}: ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function createOrderInKds(row) {
  const payload = {
    number: Number(row.number),
    customerName: String(row.customername || ''),
    observations: String(row.observations || ''),
    items: parseItems(row.itemsjson),
  };

  if (!payload.number || Number.isNaN(payload.number)) {
    throw new Error(`invalid order number for externalId=${row.externalid}`);
  }

  if (!payload.items.length) {
    payload.items = [{ name: 'Pedido sem itens detalhados', quantity: 1, notes: '' }];
  }

  return callKdsApi('/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function updateOrderStatusInKds(kdsOrderId, status) {
  return callKdsApi(`/orders/${encodeURIComponent(kdsOrderId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

function parseUpdatedAt(value) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function syncCycle(pool, state, queryText) {
  const request = pool.request();
  request.input('lastSyncAt', sql.DateTime2, new Date(state.lastSyncAt));

  const result = await request.query(queryText);
  const rows = Array.isArray(result.recordset) ? result.recordset : [];
  const orders = groupRowsToOrders(rows);

  if (!orders.length) {
    return { processed: 0, created: 0, updated: 0, skipped: 0, lastSyncAt: state.lastSyncAt };
  }

  let processed = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let maxSyncDate = new Date(state.lastSyncAt);

  for (const row of orders) {
    const externalId = String(row.externalId || '').trim();
    const updatedAt = parseUpdatedAt(row.updatedAt);

    if (!externalId || !updatedAt) {
      skipped += 1;
      continue;
    }

    if (updatedAt > maxSyncDate) {
      maxSyncDate = updatedAt;
    }

    const mappedStatus = normalizeStatus(row.status);
    let kdsId = state.idMap[externalId];

    if (!kdsId) {
      const createdOrder = await createOrderInKds({
        number: row.number,
        customername: row.customerName,
        observations: row.observations,
        itemsjson: row.items,
        externalid: externalId,
      });
      kdsId = String(createdOrder.id);
      state.idMap[externalId] = kdsId;
      await saveState(state); // salva imediatamente para evitar duplicata em caso de crash
      created += 1;
    }

    const lastKnownStatus = state.lastStatusByExternalId[externalId] || 'received';
    if (mappedStatus !== lastKnownStatus) {
      await updateOrderStatusInKds(kdsId, mappedStatus);
      state.lastStatusByExternalId[externalId] = mappedStatus;
      updated += 1;
    }

    if (!state.lastStatusByExternalId[externalId]) {
      state.lastStatusByExternalId[externalId] = mappedStatus;
    }

    processed += 1;
  }

  state.lastSyncAt = maxSyncDate.toISOString();
  await saveState(state);

  return {
    processed,
    created,
    updated,
    skipped,
    lastSyncAt: state.lastSyncAt,
  };
}

async function validateConfig(queryText) {
  const requiredSqlEnv = ['SQL2014_USER', 'SQL2014_PASSWORD', 'SQL2014_DATABASE'];
  const missing = requiredSqlEnv.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`missing required env vars: ${missing.join(', ')}`);
  }
  if (!queryText || !queryText.trim()) {
    throw new Error('configure SQL2014_QUERY or SQL2014_QUERY_FILE with a SELECT statement');
  }
}

async function main() {
  acquireLock();

  const shutdown = () => {
    releaseLock();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', releaseLock);

  const queryText = await buildQueryText();
  await validateConfig(queryText);

  const state = await loadState();
  const pool = await sql.connect(sqlConfig);

  console.log('[sql2014-bridge] connected to SQL Server');
  console.log(`[sql2014-bridge] using state file: ${STATE_FILE}`);
  console.log(`[sql2014-bridge] polling every ${POLL_INTERVAL_MS} ms`);

  const runOnce = async () => {
    try {
      const result = await syncCycle(pool, state, queryText);
      if (result.processed > 0 || result.skipped > 0) {
        console.log(
          `[sql2014-bridge] processed=${result.processed} created=${result.created} updated=${result.updated} skipped=${result.skipped} lastSyncAt=${result.lastSyncAt}`
        );
      }
    } catch (error) {
      console.error('[sql2014-bridge] cycle failed:', error.message || error);
    }
  };

  await runOnce();
  setInterval(runOnce, POLL_INTERVAL_MS);
}

main().catch(error => {
  console.error('[sql2014-bridge] fatal error:', error.message || error);
  process.exit(1);
});