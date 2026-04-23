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
  // Prioriza launchCode (novo campo da query de Lançamento)
  const candidates = [
    row.launchcode,      // Novo campo principal
    row.lancamentoid,
    row.launchid,
    row.externalid,      // Fallback
    row.pedidocodigo,
    row.pedidoid,
    row.idpedido,
  ];

  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }

  return '';
}

function parseLancamentoIdFromRow(row) {
  const candidates = [
    row.lancamentoid,
    row.launchid,
    row.lancamento,
  ];

  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }

  return null;
}

function buildDemandId(externalId, updatedAt) {
  const ext = String(externalId || '').trim();
  if (!ext || !updatedAt) return null;
  return `${ext}::${updatedAt.toISOString()}`;
}

function buildSyncKey(externalId, demandId) {
  const ext = String(externalId || '').trim();
  const demand = String(demandId || '').trim();
  if (!ext) return '';
  if (!demand) return ext;
  if (demand.startsWith(`${ext}::`)) return demand;
  return `${ext}::${demand}`;
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
  const productIdRaw = row.produtoid ?? row.productid ?? row.codigo ?? row.code;
  const productId = productIdRaw != null ? String(productIdRaw).trim() : '';
  const normalizedNameToken = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const launchCode = parseLaunchCodeFromRow(row);

  const sourceItemKey = launchCode
    ? [
      launchCode,
      itemSequence || 'item',
      productId || 'prod',
      normalizedNameToken || 'name',
    ].join(':')
    : null;

  return {
    name,
    quantity: Number.isFinite(quantityNumber) && quantityNumber > 0 ? quantityNumber : 1,
    notes: String(row.itemnotes ?? row.observacoes ?? row.notes ?? ''),
    sectorId: sectorNormalized || null,
    sourceItemKey,
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

function normalizeServiceModeKey(rawMode) {
  return parseServiceModeFromRow({ servicemode: rawMode }) || '';
}

function groupRowsToOrders(rows) {
  const grouped = new Map();
  const keepDeliveredPrincipalModes = new Set(['balcao', 'mesa', 'cartao', 'delivery', 'encomenda', 'apartamento']);

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
        lancamentoId: parseLancamentoIdFromRow(row),
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
        hasDeliveredItems: false,
        isOrderCancelled: false,
      });
    }

    const current = grouped.get(launchCode);
    if (!current.serviceMode) {
      current.serviceMode = parseServiceModeFromRow(row);
    }
    if (!current.lancamentoId) {
      current.lancamentoId = parseLancamentoIdFromRow(row);
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

    // Detecta item já entregue na mesa pelo bitmask numérico (bit 6 = 64 = Entregue no PDV)
    const rawItemStatusNum = Number(row.itemstatus ?? row.status ?? -1);
    const isItemDelivered = Number.isFinite(rawItemStatusNum) && rawItemStatusNum >= 0 && (rawItemStatusNum & 64) !== 0;

    const itemStatus = normalizeStatus(row.itemstatus ?? row.status);
    const effectiveServiceMode = normalizeServiceModeKey(current.serviceMode || parseServiceModeFromRow(row));
    const shouldKeepDeliveredPrincipalItem = keepDeliveredPrincipalModes.has(effectiveServiceMode || '');
    if (isItemDelivered) {
      current.hasDeliveredItems = true;
      if (!shouldKeepDeliveredPrincipalItem) {
        // Fora de balcao/mesa/cartao/delivery/encomenda/apartamento, mantém comportamento legado de não reenviar item entregue.
        console.log(`[sql2014-bridge] item já entregue ignorado: externalId=${launchCode} item=${row.itemname || '?'} status=${rawItemStatusNum}`);
        continue;
      }

      // Balcão/mesa/cartão/delivery/encomenda/apartamento: mantém item principal no payload para não perder itens em pedidos mistos
      // (ex.: um item com status 64 e outro com status 0 no mesmo pedido).
      console.log(`[sql2014-bridge] item com status entregue detectado: externalId=${launchCode} item=${row.itemname || '?'} status=${rawItemStatusNum}`);
    } else if (itemStatus === 'cancelled') {
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
    } else if (!order.hasActiveItems && order.hasCancelledItems && !order.hasDeliveredItems) {
      finalStatus = 'cancelled';
    } else if (!order.hasActiveItems && order.hasDeliveredItems) {
      // Todos os itens já foram entregues na mesa — marcar como entregue no KDS
      finalStatus = 'delivered';
    } else {
      const normalized = normalizeStatus(order.status);
      // Se a SQL trouxe um status explícito, respeita (exceto forçar 'received' para novos)
      finalStatus = normalized || 'received';
    }

    return {
      ...order,
      demandId: buildDemandId(order.externalId, order.updatedAt),
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
      lastItemsSnapshotByExternalId: parsed.lastItemsSnapshotByExternalId || {},
    };
  } catch {
    const initialLastSyncAt = getInitialLastSyncAt();
    console.warn(`[sql2014-bridge] state file nao encontrado; iniciando lastSyncAt=${initialLastSyncAt}`);
    return {
      lastSyncAt: initialLastSyncAt,
      idMap: {},
      lastStatusByExternalId: {},
      blockedExternalIds: {},
      lastItemsSnapshotByExternalId: {},
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

  // demandId vem do agrupamento SQL (estável por externalId + updatedAt).
  // Mantemos fallback legado para não quebrar compatibilidade.
  const externalIdStr = String(row.externalid || '').trim();
  const fallbackUpdatedAt = parseUpdatedAt(row.updatedAt);
  const demandId = String(row.demandId || '').trim() || buildDemandId(externalIdStr, fallbackUpdatedAt);

  const payload = {
    number: Number(row.number),
    externalid: externalIdStr || undefined,
    lancamentoId: String(row.lancamentoId || '').trim() || undefined,
    demandId: demandId || undefined,
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

function buildItemFingerprint(item) {
  const sourceItemKey = String(item?.sourceItemKey || '').trim();
  if (sourceItemKey) return `src:${sourceItemKey}`;

  const comparable = {
    name: String(item?.name || '').trim(),
    quantity: Number(item?.quantity || 1),
    notes: String(item?.notes || '').trim(),
    sectorId: item?.sectorId == null ? null : String(item.sectorId).trim(),
  };

  return `cmp:${JSON.stringify(comparable)}`;
}

function snapshotToCountMap(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const map = new Map();
  for (const [key, rawCount] of Object.entries(source)) {
    const count = Number(rawCount || 0);
    if (!key || !Number.isFinite(count) || count <= 0) continue;
    map.set(key, count);
  }
  return map;
}

function buildItemsSnapshot(items) {
  const counts = {};
  for (const item of Array.isArray(items) ? items : []) {
    const fingerprint = buildItemFingerprint(item);
    counts[fingerprint] = Number(counts[fingerprint] || 0) + 1;
  }
  return counts;
}

function getDeltaItems(currentItems, previousSnapshot) {
  const previousCounts = snapshotToCountMap(previousSnapshot);
  const delta = [];

  for (const item of Array.isArray(currentItems) ? currentItems : []) {
    const fingerprint = buildItemFingerprint(item);
    const available = Number(previousCounts.get(fingerprint) || 0);

    if (available > 0) {
      previousCounts.set(fingerprint, available - 1);
      continue;
    }

    delta.push(item);
  }

  return delta;
}

function buildNextLastSyncAt(maxSyncDate, currentLastSyncAt) {
  const nextValue = new Date(maxSyncDate.getTime() - SQL_SYNC_OVERLAP_MS);
  if (Number.isNaN(nextValue.getTime())) {
    return maxSyncDate.toISOString();
  }

  const current = parseUpdatedAt(currentLastSyncAt);
  if (!current) {
    return nextValue.toISOString();
  }

  // Evita ficar preso reprocessando o mesmo lote quando overlap resulta no mesmo cursor.
  if (nextValue.getTime() <= current.getTime()) {
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
    const firstRow = rows[0];
    console.log(`[sql2014-bridge] primeira linha: externalId=${firstRow.externalId} launchCode=${firstRow.launchCode} number=${firstRow.number} updatedAt=${firstRow.updatedAt}`);
    console.log(`[sql2014-bridge] estrutura: serviceMode=${firstRow.serviceMode} tipoAtendimento=${firstRow.tipoAtendimento} sellerName=${firstRow.sellerName || 'null'}`);
  }

  const orders = groupRowsToOrders(rows);
  console.log(`[sql2014-bridge] agrupado em ${orders.length} pedidos (demandas)`);
  
  // Log dos primeiros pedidos para debug
  if (orders.length > 0) {
    orders.slice(0, 3).forEach(o => {
      const demandInfo = o.demandId ? ` demandId=${o.demandId}` : '';
      console.log(`[sql2014-bridge] demanda ${o.externalId}${demandInfo}: itens=${o.items.length}, vendedor=${o.sellerName || 'null'}, atendimento=${o.attendant}, modo=${o.serviceMode}`);
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
  // Encomenda não deve entrar no KDS pela transição de pagamento/entrega;
  // deve entrar apenas no lançamento inicial do pedido.
  const keepDeliveredOrderModes = new Set(['balcao', 'mesa', 'cartao', 'delivery', 'apartamento']);

  for (const row of orders) {
    const externalId = String(row.externalId || '').trim();
    const demandId = String(row.demandId || '').trim() || buildDemandId(externalId, parseUpdatedAt(row.updatedAt));
    const syncKey = buildSyncKey(externalId, demandId);
    const updatedAt = parseUpdatedAt(row.updatedAt);

    if (!externalId || !updatedAt || !syncKey) {
      skipped += 1;
      continue;
    }

    if (updatedAt > maxSyncDate) {
      maxSyncDate = updatedAt;
    }

    const mappedStatus = normalizeStatus(row.status);
    const mode = normalizeServiceModeKey(row.serviceMode);
    const shouldAllowDeliveredUnseen = mappedStatus === 'delivered' && keepDeliveredOrderModes.has(mode);
    const currentItems = Array.isArray(row.items) ? row.items : [];
    const previousItemsSnapshot = state.lastItemsSnapshotByExternalId?.[externalId] || {};
    const deltaItems = getDeltaItems(currentItems, previousItemsSnapshot);
    const hasDemandScope = Boolean(demandId);
    // Fallback por externalId evita perder vínculo quando demandId muda por atualização da SQL.
    let kdsId = hasDemandScope
      ? (state.idMap[syncKey] || state.idMap[externalId])
      : (state.idMap[syncKey] || state.idMap[externalId]);

    const blocked = hasDemandScope
      ? state.blockedExternalIds?.[syncKey]
      : (state.blockedExternalIds?.[syncKey] || state.blockedExternalIds?.[externalId]);
    if (blocked) {
      skipped += 1;
      continue;
    }

    // Se o pedido já veio como entregue e ainda não existe no KDS, por padrão não cria para evitar poluição.
    // Exceção: balcao/mesa/cartão/delivery/apartamento podem chegar da origem já com flag "entregue" no lançamento,
    // mas ainda precisam aparecer no KDS (caso real: mesa 02 com pedidos 114898/114899).
    if (mappedStatus === 'delivered' && !kdsId) {
      if (!keepDeliveredOrderModes.has(mode)) {
        console.log(`[sql2014-bridge] lançamento já entregue ignorado (nunca foi para KDS): externalId=${externalId} mode=${mode || 'desconhecido'}`);
        // Avança o cursor mesmo assim para não reprocessar
        state.lastStatusByExternalId[syncKey] = 'delivered';
        state.lastItemsSnapshotByExternalId[externalId] = buildItemsSnapshot(currentItems);
        skipped += 1;
        continue;
      }

      console.log(`[sql2014-bridge] lançamento entregue aceito para modo ${mode}: externalId=${externalId}`);
    }

    // Para demanda nova da mesma comanda, cria card apenas quando houver item novo.
    if (!kdsId && deltaItems.length === 0 && !shouldAllowDeliveredUnseen) {
      state.lastItemsSnapshotByExternalId[externalId] = buildItemsSnapshot(currentItems);
      skipped += 1;
      continue;
    }

    const itemsToSend = kdsId ? currentItems : (deltaItems.length > 0 ? deltaItems : currentItems);

    try {
      // Se já existe mapeamento no KDS, não reposta /orders para evitar duplicidade
      // em atualizações de pagamento/entrega (caso comum em encomenda).
      if (!kdsId) {
        const syncedOrder = await createOrderInKds({
          number: row.number,
          customername: row.customerName,
          lancamentoId: row.lancamentoId,
          serviceMode: row.serviceMode,
          attendant: row.attendant,
          integrator: row.integrator,
          sellerName: row.sellerName,
          observations: row.observations,
          itemsjson: itemsToSend,
          externalid: externalId,
          demandId,
          updatedAt: updatedAt.toISOString(),
        }, {
          suppressAutoPrint: options.suppressAutoPrint === true,
        });

        const syncedOrderId = String(syncedOrder?.id || '').trim() || null;
        if (syncedOrderId) {
          kdsId = syncedOrderId;
          state.idMap[syncKey] = kdsId;
          state.idMap[externalId] = kdsId;
          await saveState(state); // salva imediatamente para evitar duplicata em caso de crash
          created += 1;
        }
      }

      if (kdsId) {
        // Pedido já existe no KDS: preservar status se está em 'preparing' ou 'ready'
        // Só sincronizar status novamente se voltou para 'received' na SQL (contra-sincronização)
        const lastKnownStatus = hasDemandScope
          ? (state.lastStatusByExternalId[syncKey] || 'received')
          : (state.lastStatusByExternalId[syncKey] || state.lastStatusByExternalId[externalId] || 'received');

        // Apenas atualizar se a SQL força voltar para 'received' (caso contrário, respeita KDS)
        if (mappedStatus === 'received' && lastKnownStatus !== 'received') {
          // SQL voltou para 'received': pode significar cancelamento, então sincroniza
          const didUpdate = await safeUpdateOrderStatusInKds(kdsId, mappedStatus, { externalId });
          if (didUpdate) {
            state.lastStatusByExternalId[syncKey] = mappedStatus;
            updated += 1;
          }
        } else if (mappedStatus !== lastKnownStatus && mappedStatus !== 'preparing' && mappedStatus !== 'ready') {
          // Apenas sincroniza status de 'cancelled' ou outros status administrativos
          const didUpdate = await safeUpdateOrderStatusInKds(kdsId, mappedStatus, { externalId });
          if (didUpdate) {
            state.lastStatusByExternalId[syncKey] = mappedStatus;
            updated += 1;
          }
        }
      }

      if (!state.lastStatusByExternalId[syncKey]) {
        state.lastStatusByExternalId[syncKey] = mappedStatus;
      }

      state.lastItemsSnapshotByExternalId[externalId] = buildItemsSnapshot(currentItems);

      processed += 1;
    } catch (error) {
      const message = String(error?.message || error || '');
      if (isPermanentOrderError(message)) {
        state.blockedExternalIds[syncKey] = {
          blockedAt: new Date().toISOString(),
          lastUpdatedAt: updatedAt.toISOString(),
          reason: message.slice(0, 500),
        };
        skipped += 1;
        console.warn(`[sql2014-bridge] pedido bloqueado para evitar replay: key=${syncKey} reason=${message}`);
        continue;
      }
      throw error;
    }
  }

  state.lastSyncAt = buildNextLastSyncAt(maxSyncDate, state.lastSyncAt);
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