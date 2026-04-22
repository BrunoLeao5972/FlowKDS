const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const sql = require('mssql');

const RUNTIME_DIR = process.pkg ? path.join(path.dirname(process.execPath), 'scripts') : __dirname;
const ENV_PATH = process.pkg ? path.join(path.dirname(process.execPath), '.env') : path.join(__dirname, '..', '.env');
require('dotenv').config({ path: ENV_PATH });

const PID_FILE = path.resolve(RUNTIME_DIR, '.sql2014-bridge.pid');

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
const STATE_FILE = path.resolve(RUNTIME_DIR, process.env.SQL2014_STATE_FILE || '.sql2014-bridge-state.json');
const KDS_API_BASE = String(process.env.KDS_API_BASE || 'http://127.0.0.1:8081').replace(/\/$/, '');
const SQL_QUERY_FILE = process.env.SQL2014_QUERY_FILE ? path.resolve(RUNTIME_DIR, process.env.SQL2014_QUERY_FILE) : null;
const SQL_QUERY = process.env.SQL2014_QUERY || '';
const SQL_STATUS_MODE = String(process.env.SQL2014_STATUS_MODE || 'parity').trim().toLowerCase();
const SQL_START_FROM_NOW = toBool(getEnv('SQL2014_START_FROM_NOW', 'true'), true);
const SQL_SYNC_OVERLAP_MS = Math.max(0, Number(getEnv('SQL2014_SYNC_OVERLAP_MS', '1000')) || 0);
const SQL_DISALLOW_HISTORICAL_REPLAY = toBool(getEnv('SQL2014_DISALLOW_HISTORICAL_REPLAY', 'true'), true);

function getInitialLastSyncAt() {
  // Em instalações sem state file, iniciar do "agora" evita reimportar histórico antigo.
  if (SQL_START_FROM_NOW) {
    return new Date().toISOString();
  }

  const configured = String(process.env.SQL2014_INITIAL_SYNC_AT || '').trim();
  if (!configured) return '1970-01-01T00:00:00.000Z';
  const parsed = new Date(configured);
  if (Number.isNaN(parsed.getTime())) return '1970-01-01T00:00:00.000Z';
  return parsed.toISOString();
}

function isPermanentOrderError(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('service_mode_not_enabled')
    || normalized.includes('unsupported service mode')
    || normalized.includes('invalid order number')
    || normalized.includes('validation')
  );
}

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
      .map(item => {
        const rawSector = item?.sectorId ?? item?.sectorid ?? item?.setorId ?? item?.setorid ?? item?.setor;
        const sectorNormalized = rawSector != null ? String(rawSector).trim() : '';
        const rawSourceItemKey = item?.sourceItemKey ?? item?.sourceitemkey ?? item?.itemKey ?? item?.itemkey;
        const sourceItemKey = rawSourceItemKey != null ? String(rawSourceItemKey).trim() : '';
        return {
          name: String(item?.name || '').trim(),
          quantity: Number(item?.quantity || 1),
          notes: String(item?.notes || ''),
          sectorId: sectorNormalized || null,
          sourceItemKey: sourceItemKey || null,
        };
      })
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

function parseLaunchCodeFromRow(row) {
  const candidates = [
    row.lancamentoid,
    row.launchid,
    row.launchcode,
    row.pedidocodigo,
    row.pedidoid,
    row.idpedido,
    row.externalid,
  ];

  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }

  return '';
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

  const rawSector = row.sectorid ?? row.setorid ?? row.setor;
  const sectorNormalized = rawSector != null ? String(rawSector).trim() : '';
  const itemSequenceRaw = row.itemsequence ?? row.item ?? row.itemid;
  const itemSequence = itemSequenceRaw != null ? String(itemSequenceRaw).trim() : '';
  const launchCode = parseLaunchCodeFromRow(row);

  return {
    name,
    quantity: Number.isFinite(quantityNumber) && quantityNumber > 0 ? quantityNumber : 1,
    notes: String(row.itemnotes ?? row.observacoes ?? row.notes ?? ''),
    sectorId: sectorNormalized || null,
    sourceItemKey: launchCode && itemSequence ? `${launchCode}:${itemSequence}` : null,
  };
}

function parseAttendantFromRow(row) {
  // Usa attendantNumber (Atendimento da SQL) para Mesa/Cartão/Apartamento/Serviço
  const attendantNum = row.attendantnumber ?? row.Atendimento;
  if (attendantNum !== undefined && attendantNum !== null && attendantNum !== 0) {
    return String(attendantNum);
  }

  // Fallback para campos tradicionais de atendente
  const raw = String(
    row.attendant
    ?? row.atendente
    ?? row.garcom
    ?? row.waiter
    ?? row.servidor
    ?? ''
  ).trim();
  return raw || null;
}

function parseSellerNameFromRow(row) {
  // Procura por campos com nome do vendedor/garçom
  const raw = String(
    row.sellername
    ?? row.SellerName
    ?? row.vendedor
    ?? row.Vendedor
    ?? row.garcomnome
    ?? row.GarcomNome
    ?? row.waitername
    ?? row.WaiterName
    ?? row.nomegarcom
    ?? row.NomeGarcom
    ?? row.funcionario
    ?? row.Funcionario
    ?? row.usuariocadastro
    ?? row.UsuarioCadastro
    ?? ''
  ).trim();
  return raw || null;
}

function parseIntegratorFromRow(row) {
  const idRaw = row.integratorid ?? row.integradora ?? row.integradoraid;
  const nameRaw = row.integratorname ?? row.integradoranome;

  const id = idRaw === undefined || idRaw === null || idRaw === '' ? null : String(idRaw).trim();
  const name = String(nameRaw || '').trim() || null;

  if (!id && !name) return null;
  return {
    id,
    name,
  };
}

function parseServiceModeFromRow(row) {
  const rawValue = row.servicemode
    ?? row.modalidade
    ?? row.modality
    ?? row.tipoatendimento
    ?? row.atendimentotipo
    ?? row.atendimento;

  const raw = String(rawValue || '').trim().toLowerCase();
  if (!raw) return null;

  const numericModeMap = {
    '16': 'balcao',       // Balcão
    '17': 'mesa',         // Mesa
    '18': 'apartamento',  // Apartamento
    '20': 'servico',      // Serviço
    '21': 'cartao',       // Cartão
    '22': 'delivery',     // Delivery
    '23': 'encomenda',    // Encomenda
    // Códigos antigos (compatibilidade)
    '1': 'balcao',
    '2': 'mesa',
    '3': 'cartao',
    '4': 'delivery',
    '5': 'encomenda',
    '6': 'servico',
    '7': 'apartamento',
  };

  if (numericModeMap[raw]) {
    return numericModeMap[raw];
  }

  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const aliasMap = {
    balcao: 'balcao',
    mesa: 'mesa',
    cartao: 'cartao',
    delivery: 'delivery',
    entrega: 'delivery',
    encomenda: 'encomenda',
    servico: 'servico',
    apartamento: 'apartamento',
  };

  return aliasMap[normalized] || null;
}

function groupRowsToOrders(rows) {
  const grouped = new Map();

  for (const rawRow of rows) {
    const row = lowerCaseKeys(rawRow);
    const launchCode = parseLaunchCodeFromRow(row);
    if (!launchCode) continue;

    const updatedAt = parseUpdatedAt(row.updatedat);
    if (!updatedAt) continue;

    if (!grouped.has(launchCode)) {
      grouped.set(launchCode, {
        externalId: launchCode,
        sourceExternalId: launchCode,
        number: row.number,
        customerName: row.customername,
        serviceMode: parseServiceModeFromRow(row),
        attendant: parseAttendantFromRow(row),
        integrator: parseIntegratorFromRow(row),
        sellerName: parseSellerNameFromRow(row),
        observations: row.observations,
        status: row.status,
        updatedAt,
        items: [],
        hasActiveItems: false,
        hasCancelledItems: false,
        isOrderCancelled: false,
      });
    }

    const current = grouped.get(launchCode);
    if (!current.serviceMode) {
      current.serviceMode = parseServiceModeFromRow(row);
    }
    if (!current.attendant) {
      current.attendant = parseAttendantFromRow(row);
    }
    if (!current.integrator) {
      current.integrator = parseIntegratorFromRow(row);
    }
    if (!current.sellerName) {
      current.sellerName = parseSellerNameFromRow(row);
    }
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

    // Ignora insumos/subitens (SubItem > 0), mantém apenas itens principais (SubItem = 0 ou null)
    const subItemValue = row.subitem ?? row.SubItem ?? row.SUBITEM ?? 0;
    const isInsumo = Number(subItemValue) > 0;
    if (isInsumo) {
      console.log(`[sql2014-bridge] ignorando insumo: externalId=${launchCode} item=${row.itemname || row.produtodescricao || '?'} subItem=${subItemValue}`);
      continue;
    }

    const itemFromFlatRow = parseItemFromFlatRow(row);
    if (itemFromFlatRow) {
      current.items.push(itemFromFlatRow);
    }
  }

  return Array.from(grouped.values()).map(order => {
    // Determina o status final do pedido:
    // 1. Se foi marcado como cancelado (todos os itens), é 'cancelled'
    // 2. Se a SQL não trouxe um status explícito e há itens ativos, padrão 'received'
    // 3. Caso contrário, normaliza o status vindo da SQL
    let finalStatus = 'received';
    if (order.isOrderCancelled) {
      finalStatus = 'cancelled';
    } else if (!order.hasActiveItems && order.hasCancelledItems) {
      finalStatus = 'cancelled';
    } else {
      const normalized = normalizeStatus(order.status);
      // Se a SQL trouxe um status explícito, respeita (exceto forçar 'received' para novos)
      finalStatus = normalized || 'received';
    }

    return {
      ...order,
      status: finalStatus,
      items: order.items.length
        ? order.items
        : [{ name: 'Pedido sem itens detalhados', quantity: 1, notes: '' }],
    };
  });
}

async function loadState() {
  try {
    const content = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(content);
    const parsedLastSyncAt = parseUpdatedAt(parsed.lastSyncAt);
    const idMap = parsed.idMap || {};
    const hasMappedOrders = Object.keys(idMap).length > 0;
    let lastSyncAt = parsedLastSyncAt ? parsedLastSyncAt.toISOString() : getInitialLastSyncAt();

    // Proteção para ambiente novo/resetado: sem mapeamentos, nunca reprocessar histórico.
    if (SQL_DISALLOW_HISTORICAL_REPLAY && !hasMappedOrders) {
      const forcedNow = new Date().toISOString();
      if (!parsedLastSyncAt || parsedLastSyncAt.getTime() < Date.now() - 60000) {
        console.warn(
          `[sql2014-bridge] replay historico bloqueado (state sem idMap). Ajustando lastSyncAt para agora: ${forcedNow}`
        );
      }
      lastSyncAt = forcedNow;
    }

    return {
      lastSyncAt,
      idMap,
      lastStatusByExternalId: parsed.lastStatusByExternalId || {},
      blockedExternalIds: parsed.blockedExternalIds || {},
    };
  } catch {
    const initialLastSyncAt = getInitialLastSyncAt();
    console.warn(`[sql2014-bridge] state file nao encontrado; iniciando lastSyncAt=${initialLastSyncAt}`);
    return {
      lastSyncAt: initialLastSyncAt,
      idMap: {},
      lastStatusByExternalId: {},
      blockedExternalIds: {},
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

  const method = String(init.method || 'GET').toUpperCase();
  const body = init.body;
  return httpRequestJson(url, { method, headers, body });
}

function httpRequestJson(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(urlString);
    } catch (error) {
      reject(new Error(`invalid KDS_API_BASE URL: ${urlString}`));
      return;
    }

    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: `${urlObj.pathname}${urlObj.search}`,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: Number(process.env.KDS_API_TIMEOUT_MS || 10000),
      },
      res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          raw += chunk;
        });
        res.on('end', () => {
          const status = Number(res.statusCode || 0);
          if (status >= 200 && status < 300) {
            if (status === 204 || !raw) {
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(raw));
            } catch {
              resolve(raw);
            }
            return;
          }

          reject(new Error(`KDS API ${status} at ${urlObj.pathname}: ${raw}`));
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`timeout reaching KDS API at ${urlObj.origin}`));
    });

    req.on('error', error => {
      reject(new Error(`request to ${urlObj.origin} failed: ${error.message || error}`));
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// Pedidos que não geram ticket de balcão/cozinha
function shouldSuppressPrint(serviceMode) {
  const mode = String(serviceMode || '').trim().toLowerCase();
  // 17 = Mesa, 21 = Cartão (códigos do Restô/GerencialBrunoInfo)
  // '2', '3' = códigos legados
  return mode === 'mesa' || mode === 'cartao' || mode === '2' || mode === '3' || mode === '17' || mode === '21';
}

// Normaliza nome do cliente - substitui valores genéricos por string vazia
function normalizeCustomerName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  const genericNames = ['0', 'geral', 'cliente 0', 'cliente geral', 'nao identificado', 'não identificado', 'sem nome'];
  if (genericNames.includes(normalized) || normalized === '') {
    return '';
  }
  return String(name).trim();
}

async function createOrderInKds(row, options = {}) {
  const serviceMode = row.serviceMode || null;
  const suppressPrint = shouldSuppressPrint(serviceMode);
  if (suppressPrint) {
    const modeLabel = serviceMode === '17' || serviceMode === '2' ? 'mesa' : 'cartao';
    console.log(`[sql2014-bridge] pedido ${modeLabel} detectado: suppressAutoPrint=true`);
  }

  const payload = {
    number: Number(row.number),
    externalid: String(row.externalid || '').trim() || undefined,
    customerName: normalizeCustomerName(row.customername),
    serviceMode: serviceMode,
    attendant: row.attendant || null,
    integratorId: row.integrator?.id || null,
    integratorName: row.integrator?.name || null,
    sellerName: row.sellerName || null,
    observations: String(row.observations || ''),
    items: parseItems(row.itemsjson),
    sourceUpdatedAt: row.updatedAt || null,
    suppressAutoPrint: options.suppressAutoPrint === true || suppressPrint,
  };

  if (!payload.number || Number.isNaN(payload.number)) {
    throw new Error(`invalid order number for externalId=${row.externalid}`);
  }

  if (!payload.items.length) {
    payload.items = [{ name: 'Pedido sem itens detalhados', quantity: 1, notes: '', sectorId: null }];
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

async function safeUpdateOrderStatusInKds(kdsOrderId, status, context) {
  try {
    await updateOrderStatusInKds(kdsOrderId, status);
    return true;
  } catch (error) {
    const message = String(error?.message || error || '');
    if (message.includes('invalid_status_transition')) {
      console.warn(
        `[sql2014-bridge] transicao ignorada para evitar pulo de etapa: externalId=${context.externalId} kdsId=${kdsOrderId} target=${status}`
      );
      return false;
    }
    throw error;
  }
}

function parseUpdatedAt(value) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function buildNextLastSyncAt(maxSyncDate) {
  const nextValue = new Date(maxSyncDate.getTime() - SQL_SYNC_OVERLAP_MS);
  if (Number.isNaN(nextValue.getTime())) {
    return maxSyncDate.toISOString();
  }
  return nextValue.toISOString();
}

async function syncCycle(pool, state, queryText, options = {}) {
  const request = pool.request();
  request.input('lastSyncAt', sql.DateTime2, new Date(state.lastSyncAt));

  console.log(`[sql2014-bridge] executando query com lastSyncAt=${state.lastSyncAt}`);
  let result;
  try {
    result = await request.query(queryText);
  } catch (sqlError) {
    console.error('[sql2014-bridge] ERRO SQL:', sqlError.message || sqlError);
    throw sqlError;
  }

  const rows = Array.isArray(result.recordset) ? result.recordset : [];
  console.log(`[sql2014-bridge] query retornou ${rows.length} linhas`);
  if (rows.length > 0) {
    console.log(`[sql2014-bridge] primeira linha: externalId=${rows[0].externalId} number=${rows[0].number} updatedAt=${rows[0].updatedAt}`);
  }

  const orders = groupRowsToOrders(rows);
  console.log(`[sql2014-bridge] agrupado em ${orders.length} pedidos`);
  
  // Log dos primeiros pedidos para debug de sellerName
  if (orders.length > 0) {
    orders.slice(0, 3).forEach(o => {
      console.log(`[sql2014-bridge] pedido ${o.externalId}: sellerName=${o.sellerName || 'null'}, attendant=${o.attendant}, serviceMode=${o.serviceMode}`);
    });
  }

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

    const blocked = state.blockedExternalIds?.[externalId];
    if (blocked) {
      skipped += 1;
      continue;
    }

    try {
      const syncedOrder = await createOrderInKds({
        number: row.number,
        customername: row.customerName,
        serviceMode: row.serviceMode,
        attendant: row.attendant,
        integrator: row.integrator,
        sellerName: row.sellerName,
        observations: row.observations,
        itemsjson: row.items,
        externalid: externalId,
        updatedAt: updatedAt.toISOString(),
      }, {
        suppressAutoPrint: options.suppressAutoPrint === true,
      });

      const syncedOrderId = String(syncedOrder?.id || '').trim() || null;
      if (syncedOrderId) {
        if (!kdsId) {
          kdsId = syncedOrderId;
          state.idMap[externalId] = kdsId;
          await saveState(state); // salva imediatamente para evitar duplicata em caso de crash
          created += 1;
        } else if (kdsId !== syncedOrderId) {
          console.warn(
            `[sql2014-bridge] bloqueando replay de pedido removido: externalId=${externalId} kdsId antigo=${kdsId} novo=${syncedOrderId}`
          );

          // Se o pedido antigo foi removido no KDS/Mongo, nao ressuscitar automaticamente.
          try {
            await callKdsApi(`/orders/${encodeURIComponent(syncedOrderId)}`, { method: 'DELETE' });
          } catch (deleteError) {
            console.warn(
              `[sql2014-bridge] falha ao remover replay externo externalId=${externalId} kdsId=${syncedOrderId}: ${String(deleteError?.message || deleteError || '')}`
            );
          }

          state.blockedExternalIds[externalId] = {
            blockedAt: new Date().toISOString(),
            lastUpdatedAt: updatedAt.toISOString(),
            reason: `stale_mapping_resurrection_blocked old=${kdsId} new=${syncedOrderId}`,
          };
          delete state.idMap[externalId];
          await saveState(state);
          skipped += 1;
          continue;
        }
      }

      if (kdsId) {
        // Pedido já existe no KDS: preservar status se está em 'preparing' ou 'ready'
        // Só sincronizar status novamente se voltou para 'received' na SQL (contra-sincronização)
        const lastKnownStatus = state.lastStatusByExternalId[externalId] || 'received';

        // Apenas atualizar se a SQL força voltar para 'received' (caso contrário, respeita KDS)
        if (mappedStatus === 'received' && lastKnownStatus !== 'received') {
          // SQL voltou para 'received': pode significar cancelamento, então sincroniza
          const didUpdate = await safeUpdateOrderStatusInKds(kdsId, mappedStatus, { externalId });
          if (didUpdate) {
            state.lastStatusByExternalId[externalId] = mappedStatus;
            updated += 1;
          }
        } else if (mappedStatus !== lastKnownStatus && mappedStatus !== 'preparing' && mappedStatus !== 'ready') {
          // Apenas sincroniza status de 'cancelled' ou outros status administrativos
          const didUpdate = await safeUpdateOrderStatusInKds(kdsId, mappedStatus, { externalId });
          if (didUpdate) {
            state.lastStatusByExternalId[externalId] = mappedStatus;
            updated += 1;
          }
        }
      }

      if (!state.lastStatusByExternalId[externalId]) {
        state.lastStatusByExternalId[externalId] = mappedStatus;
      }

      processed += 1;
    } catch (error) {
      const message = String(error?.message || error || '');
      if (isPermanentOrderError(message)) {
        state.blockedExternalIds[externalId] = {
          blockedAt: new Date().toISOString(),
          lastUpdatedAt: updatedAt.toISOString(),
          reason: message.slice(0, 500),
        };
        skipped += 1;
        console.warn(`[sql2014-bridge] pedido bloqueado para evitar replay: externalId=${externalId} reason=${message}`);
        continue;
      }
      throw error;
    }
  }

  state.lastSyncAt = buildNextLastSyncAt(maxSyncDate);
  await saveState(state);

  return {
    processed,
    created,
    updated,
    skipped,
    lastSyncAt: state.lastSyncAt,
  };
}

async function syncSectors(pool) {
  try {
    const result = await pool.request().query('SELECT [C\u00f3digo], [Descri\u00e7\u00e3o] FROM Setores ORDER BY [C\u00f3digo]');
    const rows = Array.isArray(result.recordset) ? result.recordset : [];
    if (!rows.length) return;
    const sectors = rows.map(r => ({
      id: String(r['C\u00f3digo'] ?? r['CODIGO'] ?? r['codigo'] ?? '').trim(),
      name: String(r['Descri\u00e7\u00e3o'] ?? r['DESCRICAO'] ?? r['descricao'] ?? r['Nome'] ?? r['NOME'] ?? r['nome'] ?? '').trim(),
    })).filter(s => s.id);
    if (!sectors.length) return;
    await callKdsApi('/sectors/sync', {
      method: 'POST',
      body: JSON.stringify({ sectors }),
    });
    console.log(`[sql2014-bridge] setores sincronizados: ${sectors.length}`);
  } catch (err) {
    console.warn('[sql2014-bridge] falha ao sincronizar setores:', err.message || err);
  }
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

  // Sincroniza setores na inicializãção e depois a cada 5 minutos.
  await syncSectors(pool);
  setInterval(() => syncSectors(pool), 5 * 60 * 1000);

  let isInitialCycle = true;

  const runOnce = async () => {
    try {
      const result = await syncCycle(pool, state, queryText, {
        suppressAutoPrint: isInitialCycle,
      });
      if (result.processed > 0 || result.skipped > 0) {
        console.log(
          `[sql2014-bridge] processed=${result.processed} created=${result.created} updated=${result.updated} skipped=${result.skipped} lastSyncAt=${result.lastSyncAt}`
        );
      }
      isInitialCycle = false;
    } catch (error) {
      console.error('[sql2014-bridge] cycle failed:', error.message || error);
      isInitialCycle = false;
    }
  };

  await runOnce();
  setInterval(runOnce, POLL_INTERVAL_MS);
}

main().catch(error => {
  console.error('[sql2014-bridge] fatal error:', error.message || error);
  process.exit(1);
});