const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const https = require('https');
const sql = require('mssql');

// Resolve relativo a server/scripts/ (onde ficam os .sql e o state file), tanto em dev
// quanto empacotado — este módulo vive em server/services/, mas os arquivos configurados
// em .env (ex.: SQL2014_QUERY_FILE=./sql2014-lançamentos-query.sql) continuam relativos
// à pasta scripts/ para não quebrar instalações de cliente já configuradas.
const RUNTIME_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), 'scripts')
  : path.join(__dirname, '..', 'scripts');

const POLL_INTERVAL_MS = Number(process.env.SQL2014_POLL_INTERVAL_MS || 3000);
const STATE_FILE = path.resolve(RUNTIME_DIR, process.env.SQL2014_STATE_FILE || '.sql2014-bridge-state.json');
// Sobrescrito em startSql2014Sync() com base na porta real do servidor, a menos que
// KDS_API_BASE esteja explicitamente configurado — evita ter que manter esse valor em
// sincronia manual com PORT agora que os dois vivem no mesmo processo.
let KDS_API_BASE = String(process.env.KDS_API_BASE || 'http://127.0.0.1:8081').replace(/\/$/, '');
const SQL_QUERY_FILE = process.env.SQL2014_QUERY_FILE ? path.resolve(RUNTIME_DIR, process.env.SQL2014_QUERY_FILE) : null;
const SQL_QUERY = process.env.SQL2014_QUERY || '';
const SQL_CHANGE_TOKEN_QUERY_FILE = process.env.SQL2014_CHANGE_TOKEN_QUERY_FILE
  ? path.resolve(RUNTIME_DIR, process.env.SQL2014_CHANGE_TOKEN_QUERY_FILE)
  : null;
const SQL_CHANGE_TOKEN_QUERY = process.env.SQL2014_CHANGE_TOKEN_QUERY || '';
const SQL_CHANGE_TOKEN_ENABLED = toBool(getEnv('SQL2014_CHANGE_TOKEN_ENABLED', 'false'), false);
const SQL_STATUS_MODE = String(process.env.SQL2014_STATUS_MODE || 'parity').trim().toLowerCase();
const SQL_SYNC_OVERLAP_MS = Math.max(0, Number(getEnv('SQL2014_SYNC_OVERLAP_MS', '1000')) || 0);
// Antes da query de change-token virar sargable (ver sql2014-change-token-query.sql), esse
// piso ficava em 15s pra evitar bater com frequencia numa consulta cara (Clustered Index Scan).
// Agora que ela usa Index Seek, o custo por poll e desprezivel, entao o padrao acompanha o
// POLL_INTERVAL_MS normal — sem isso, um pedido novo podia demorar ate ~15s pra aparecer no KDS.
const SQL_IDLE_POLL_INTERVAL_MS = Math.max(
  POLL_INTERVAL_MS,
  Number(getEnv('SQL2014_IDLE_POLL_INTERVAL_MS', String(POLL_INTERVAL_MS))) || POLL_INTERVAL_MS
);

// Códigos de Produtos.Tipo (expostos pela query como productType) que NÃO devem virar item no
// KDS — ex.: Serviço, Taxa de Serviço, Taxa de Entrega, Fabricação, Grade, etc. Os códigos
// variam por instalação (confira com a query abaixo antes de configurar):
//   SELECT Tipo, COUNT(*) AS Qtde, MIN(Descrição) AS ExemploNome FROM Produtos GROUP BY Tipo;
const SQL_EXCLUDED_PRODUCT_TYPES = new Set(
  String(getEnv('SQL2014_EXCLUDED_PRODUCT_TYPES', ''))
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
);

async function fetchServerNow(pool) {
  const result = await pool.request().query('SELECT GETDATE() AS now');
  const row = lowerCaseKeys(result?.recordset?.[0] || {});
  return parseUpdatedAt(row.now) || new Date();
}

async function getInitialLastSyncAt(pool) {
  // SQL2014_INITIAL_SYNC_AT é a única forma de pedir explicitamente uma importação de
  // histórico (ex.: reprocessar pedidos desde uma data específica). Sem essa variável
  // configurada, o cursor inicial SEMPRE vem da hora atual do próprio SQL Server
  // (GETDATE()), nunca do relógio da máquina onde o servidor roda: as colunas
  // Edição/Inclusão/Emissão são gravadas pelo SQL Server, então só a hora dele garante
  // que o cursor bata com esses valores — o fuso horário/relógio do Windows local pode
  // estar divergente (ou em UTC) e já causou pedidos novos ficando de fora, além de já
  // ter causado importação de histórico inteiro travando a máquina do cliente.
  const configured = String(process.env.SQL2014_INITIAL_SYNC_AT || '').trim();
  if (configured) {
    const parsed = new Date(configured);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  try {
    const serverNow = await fetchServerNow(pool);
    return serverNow.toISOString();
  } catch (error) {
    console.warn(`[sql2014-sync] falha ao obter hora do SQL Server, usando relógio local: ${error.message || error}`);
    return new Date().toISOString();
  }
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
  requestTimeout: Number(getEnv('SQL2014_REQUEST_TIMEOUT_MS', '30000')),
  connectionTimeout: Number(getEnv('SQL2014_CONNECTION_TIMEOUT_MS', '30000')),
  options: {
    encrypt: toBool(getEnv('SQL2014_ENCRYPT', 'false')),
    trustServerCertificate: toBool(getEnv('SQL2014_TRUST_CERT', 'true')),
    enableArithAbort: true,
    // As colunas Edição/Inclusão/Emissão do SQL2014 são DATETIME2 "naive" (hora local do
    // cliente, sem timezone). Com useUTC=true (padrão do driver), o mssql envia/lê esses
    // valores usando os getters UTC do JS Date, deslocando o cursor de sincronização pelo
    // fuso horário local (ex.: 3h no Brasil) e bloqueando pedidos novos até o relógio local
    // alcançar aquele horário "no futuro". useUTC=false alinha o driver ao mesmo referencial
    // de hora local usado pelo banco do cliente.
    useUTC: toBool(getEnv('SQL2014_USE_UTC', 'false'), false),
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

function stripCombiningMarks(str) {
  // Remove marcas de combinação Unicode (acentos decompostos via NFD), no intervalo
  // U+0300-U+036F. Evita literal de regex com esse range (alguns pipelines de texto
  // acabam normalizando o escape de volta para os próprios caracteres de combinação).
  return Array.from(String(str || ''))
    .filter(ch => {
      const code = ch.codePointAt(0);
      return code < 0x300 || code > 0x36f;
    })
    .join('');
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
  const normalizedNameToken = stripCombiningMarks(String(name).normalize('NFD'))
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

  const normalized = stripCombiningMarks(raw.normalize('NFD'));

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

    // Itens de tipo não-cozinha (serviço, taxa, fabricação, grade, etc. — configurável via
    // SQL2014_EXCLUDED_PRODUCT_TYPES) não devem virar card/ficar contabilizados no KDS. Pulado
    // antes de qualquer acúmulo no pedido para não afetar status/contagem de itens ativos.
    const productType = String(row.producttype || '').trim().toLowerCase();
    if (productType && SQL_EXCLUDED_PRODUCT_TYPES.has(productType)) {
      console.log(`[sql2014-sync] item ignorado por tipo de produto excluído: externalId=${launchCode} item=${row.itemname || row.produtodescricao || '?'} productType=${productType}`);
      continue;
    }

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
        console.log(`[sql2014-sync] item já entregue ignorado: externalId=${launchCode} item=${row.itemname || '?'} status=${rawItemStatusNum}`);
        continue;
      }

      // Balcão/mesa/cartão/delivery/encomenda/apartamento: mantém item principal no payload para não perder itens em pedidos mistos
      // (ex.: um item com status 64 e outro com status 0 no mesmo pedido).
      console.log(`[sql2014-sync] item com status entregue detectado: externalId=${launchCode} item=${row.itemname || '?'} status=${rawItemStatusNum}`);
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
      console.log(`[sql2014-sync] ignorando insumo: externalId=${launchCode} item=${row.itemname || row.produtodescricao || '?'} subItem=${subItemValue}`);
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

async function loadState(pool) {
  try {
    const content = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(content);
    const idMap = parsed.idMap || {};

    // O KDS deve sincronizar só pedidos a partir do momento em que a API é iniciada — nunca
    // "retomar" um cursor antigo salvo de uma execução anterior (ex.: serviço que ficou parado
    // por dias). Por isso lastSyncAt NUNCA é lido do state file, é sempre recalculado no boot
    // (getInitialLastSyncAt: hora do SQL Server via GETDATE(), a menos que
    // SQL2014_INITIAL_SYNC_AT esteja configurado para um reprocessamento manual deliberado).
    // idMap/lastStatusByExternalId/etc. continuam vindo do arquivo — isso só afeta o cursor.
    const lastSyncAt = await getInitialLastSyncAt(pool);
    console.log(`[sql2014-sync] cursor iniciado a partir de agora (ignora lastSyncAt salvo anteriormente): ${lastSyncAt}`);

    return {
      lastSyncAt,
      idMap,
      lastStatusByExternalId: parsed.lastStatusByExternalId || {},
      blockedExternalIds: parsed.blockedExternalIds || {},
      lastItemsSnapshotByExternalId: parsed.lastItemsSnapshotByExternalId || {},
    };
  } catch {
    const initialLastSyncAt = await getInitialLastSyncAt(pool);
    console.warn(`[sql2014-sync] state file nao encontrado; iniciando lastSyncAt=${initialLastSyncAt}`);
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

async function buildChangeTokenQueryText() {
  if (SQL_CHANGE_TOKEN_QUERY_FILE) {
    return fs.readFile(SQL_CHANGE_TOKEN_QUERY_FILE, 'utf8');
  }
  return SQL_CHANGE_TOKEN_QUERY;
}

// Sentinela para "consultei e não há mudanças" (MAX(...) de um WHERE sem linhas retorna NULL).
// Precisa ser distinto de `null`, que sinaliza "não consegui obter um token" (recordset vazio,
// query mal configurada). Sem essa distinção, todo ciclo ocioso (o caso mais comum) caía no
// fallback de rodar a query pesada completa a cada poll, martelando o SQL2014 do cliente.
const NO_CHANGES_TOKEN = '__no_changes__';

function extractChangeToken(result) {
  const rows = Array.isArray(result?.recordset) ? result.recordset : [];
  if (!rows.length) return null;

  const row = lowerCaseKeys(rows[0]);
  const firstValue = Object.values(row)[0];
  const rawValue = row.changetoken ?? row.token ?? row.maxupdatedat ?? row.updatedat ?? firstValue;

  if (rawValue === undefined || rawValue === null) return NO_CHANGES_TOKEN;
  if (rawValue instanceof Date) return rawValue.toISOString();

  const textValue = String(rawValue).trim();
  return textValue || NO_CHANGES_TOKEN;
}

async function getChangeToken(pool, state, changeTokenQueryText) {
  if (!SQL_CHANGE_TOKEN_ENABLED || !changeTokenQueryText || !changeTokenQueryText.trim()) {
    return null;
  }

  const request = pool.request();
  request.input('lastSyncAt', sql.DateTime2, new Date(state.lastSyncAt));

  const result = await request.query(changeTokenQueryText);
  return extractChangeToken(result);
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
    console.log(`[sql2014-sync] pedido ${modeLabel} detectado: suppressAutoPrint=true`);
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
        `[sql2014-sync] transicao ignorada para evitar pulo de etapa: externalId=${context.externalId} kdsId=${kdsOrderId} target=${status}`
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

  console.log(`[sql2014-sync] executando query com lastSyncAt=${state.lastSyncAt}`);
  let result;
  try {
    result = await request.query(queryText);
  } catch (sqlError) {
    console.error('[sql2014-sync] ERRO SQL:', sqlError.message || sqlError);
    throw sqlError;
  }

  const rows = Array.isArray(result.recordset) ? result.recordset : [];
  console.log(`[sql2014-sync] query retornou ${rows.length} linhas`);
  if (rows.length > 0) {
    const firstRow = rows[0];
    console.log(`[sql2014-sync] primeira linha: externalId=${firstRow.externalId} launchCode=${firstRow.launchCode} number=${firstRow.number} updatedAt=${firstRow.updatedAt}`);
    console.log(`[sql2014-sync] estrutura: serviceMode=${firstRow.serviceMode} tipoAtendimento=${firstRow.tipoAtendimento} sellerName=${firstRow.sellerName || 'null'}`);
  }

  const orders = groupRowsToOrders(rows);
  console.log(`[sql2014-sync] agrupado em ${orders.length} pedidos (demandas)`);

  // Log dos primeiros pedidos para debug
  if (orders.length > 0) {
    orders.slice(0, 3).forEach(o => {
      const demandInfo = o.demandId ? ` demandId=${o.demandId}` : '';
      console.log(`[sql2014-sync] demanda ${o.externalId}${demandInfo}: itens=${o.items.length}, vendedor=${o.sellerName || 'null'}, atendimento=${o.attendant}, modo=${o.serviceMode}`);
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
        console.log(`[sql2014-sync] lançamento já entregue ignorado (nunca foi para KDS): externalId=${externalId} mode=${mode || 'desconhecido'}`);
        // Avança o cursor mesmo assim para não reprocessar
        state.lastStatusByExternalId[syncKey] = 'delivered';
        state.lastItemsSnapshotByExternalId[externalId] = buildItemsSnapshot(currentItems);
        skipped += 1;
        continue;
      }

      console.log(`[sql2014-sync] lançamento entregue aceito para modo ${mode}: externalId=${externalId}`);
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
        console.warn(`[sql2014-sync] pedido bloqueado para evitar replay: key=${syncKey} reason=${message}`);
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

// Índices que aceleram o filtro incremental (COALESCE ... > @lastSyncAt) e os JOINs da query.
// Idempotente: seguro rodar em toda inicialização, em qualquer instalação de cliente.
// Nomes de coluna conferidos contra o schema real (INFORMATION_SCHEMA.COLUMNS) de uma base
// de cliente: as views vwLancamentos/vwPedidosProdutos expõem aliases (ClienteID, PedidoID,
// ProdutoID, LancamentoID...) que NÃO existem nas tabelas base — lá os nomes reais são
// Cliente, Pedido, Produto, Lancamento. Os índices precisam ir na tabela base com o nome real.
const PERFORMANCE_INDEXES = [
  { name: 'IX_Lançamentos_DataDeEdição', table: 'dbo.Lançamentos', column: '[DataDeEdição]' },
  { name: 'IX_Pedidos_Produtos_DataDeEdição', table: 'dbo.Pedidos_Produtos', column: '[DataDeEdição]' },
  { name: 'IX_Lançamentos_Cliente', table: 'dbo.Lançamentos', column: '[Cliente]' },
  { name: 'IX_Lançamentos_Integradora', table: 'dbo.Lançamentos', column: '[Integradora]' },
  // Chave do INNER JOIN principal entre as duas views — a mais valiosa das novas.
  { name: 'IX_Pedidos_Produtos_Lancamento', table: 'dbo.Pedidos_Produtos', column: '[Lancamento]' },
  { name: 'IX_Pedidos_Produtos_Pedido', table: 'dbo.Pedidos_Produtos', column: '[Pedido]' },
  { name: 'IX_Pedidos_Produtos_Produto', table: 'dbo.Pedidos_Produtos', column: '[Produto]' },
];

async function ensurePerformanceIndexes(pool) {
  for (const idx of PERFORMANCE_INDEXES) {
    try {
      await pool.request().query(`
        IF NOT EXISTS (
          SELECT 1 FROM sys.indexes WHERE name = '${idx.name}'
          AND object_id = OBJECT_ID('${idx.table}')
        )
        CREATE NONCLUSTERED INDEX [${idx.name}]
        ON ${idx.table} (${idx.column});
      `);
      console.log(`[sql2014-sync] índice de performance ok: ${idx.name}`);
    } catch (err) {
      // Não bloqueia a sincronização de pedidos por falta de permissão de DDL no cliente.
      console.warn(`[sql2014-sync] não foi possível criar índice ${idx.name}:`, err.message || err);
    }
  }
}

async function syncSectors(pool) {
  try {
    const result = await pool.request().query('SELECT [Código], [Descrição] FROM Setores ORDER BY [Código]');
    const rows = Array.isArray(result.recordset) ? result.recordset : [];
    if (!rows.length) return;
    const sectors = rows.map(r => ({
      id: String(r['Código'] ?? r['CODIGO'] ?? r['codigo'] ?? '').trim(),
      name: String(r['Descrição'] ?? r['DESCRICAO'] ?? r['descricao'] ?? r['Nome'] ?? r['NOME'] ?? r['nome'] ?? '').trim(),
    })).filter(s => s.id);
    if (!sectors.length) return;
    await callKdsApi('/sectors/sync', {
      method: 'POST',
      body: JSON.stringify({ sectors }),
    });
    console.log(`[sql2014-sync] setores sincronizados: ${sectors.length}`);
  } catch (err) {
    console.warn('[sql2014-sync] falha ao sincronizar setores:', err.message || err);
  }
}

// Ponto de entrada único, chamado por server/index.js depois que o HTTP já está no ar.
// Nunca lança/derruba o processo chamador: falta de configuração ou SQL2014 fora do ar
// apenas desabilitam/atrasam a sincronização, sem afetar o resto do KDS.
async function startSql2014Sync({ port } = {}) {
  const requiredSqlEnv = ['SQL2014_USER', 'SQL2014_PASSWORD', 'SQL2014_DATABASE'];
  const missingEnv = requiredSqlEnv.filter(name => !process.env[name]);
  if (missingEnv.length) {
    console.log(`[sql2014-sync] não configurado (faltam ${missingEnv.join(', ')}); sincronização com SQL2014 desabilitada`);
    return () => {};
  }

  KDS_API_BASE = String(process.env.KDS_API_BASE || `http://127.0.0.1:${port || process.env.PORT || 8081}`).replace(/\/$/, '');

  let queryText;
  let changeTokenQueryText;
  try {
    queryText = await buildQueryText();
    changeTokenQueryText = await buildChangeTokenQueryText();
  } catch (error) {
    console.error('[sql2014-sync] falha ao carregar arquivo(s) de query:', error.message || error);
    return () => {};
  }

  if (!queryText || !queryText.trim()) {
    console.warn('[sql2014-sync] SQL2014_QUERY/SQL2014_QUERY_FILE não configurado; sincronização com SQL2014 desabilitada');
    return () => {};
  }

  if (SQL_CHANGE_TOKEN_ENABLED && !changeTokenQueryText.trim()) {
    console.warn('[sql2014-sync] SQL2014_CHANGE_TOKEN_ENABLED=true requer SQL2014_CHANGE_TOKEN_QUERY(_FILE); sincronização com SQL2014 desabilitada');
    return () => {};
  }

  let stopped = false;
  let pool = null;
  let sectorsIntervalHandle = null;
  let pollTimeoutHandle = null;

  const stop = () => {
    stopped = true;
    if (sectorsIntervalHandle) clearInterval(sectorsIntervalHandle);
    if (pollTimeoutHandle) clearTimeout(pollTimeoutHandle);
    if (pool) pool.close().catch(() => {});
  };

  (async () => {
    let attempt = 0;
    while (!stopped && !pool) {
      try {
        pool = await sql.connect(sqlConfig);
      } catch (error) {
        attempt += 1;
        const delayMs = Math.min(60000, 5000 * Math.pow(2, attempt - 1));
        console.warn(`[sql2014-sync] falha ao conectar no SQL Server (tentativa ${attempt}): ${error.message || error}. Nova tentativa em ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    if (stopped || !pool) return;

    console.log('[sql2014-sync] connected to SQL Server');

    const state = await loadState(pool);

    console.log(`[sql2014-sync] using state file: ${STATE_FILE}`);
    console.log(`[sql2014-sync] polling every ${POLL_INTERVAL_MS} ms`);
    if (SQL_IDLE_POLL_INTERVAL_MS > POLL_INTERVAL_MS) {
      console.log(`[sql2014-sync] idle polling every ${SQL_IDLE_POLL_INTERVAL_MS} ms when no changes are detected`);
    }
    if (SQL_CHANGE_TOKEN_ENABLED) {
      console.log('[sql2014-sync] lightweight change-token detection is enabled');
    }

    // Garante os índices de performance no banco do cliente (idempotente, roda em toda inicialização).
    await ensurePerformanceIndexes(pool);

    // Sincroniza setores na inicialização e depois a cada 5 minutos.
    await syncSectors(pool);
    sectorsIntervalHandle = setInterval(() => syncSectors(pool), 5 * 60 * 1000);

    let isInitialCycle = true;
    let lastChangeToken = null;
    let noChangeStreak = 0;

    const runOnce = async () => {
      let nextDelayMs = POLL_INTERVAL_MS;

      try {
        if (SQL_CHANGE_TOKEN_ENABLED) {
          const token = await getChangeToken(pool, state, changeTokenQueryText);
          if (token && token === lastChangeToken) {
            noChangeStreak += 1;
            nextDelayMs = SQL_IDLE_POLL_INTERVAL_MS;
            if (noChangeStreak === 1 || noChangeStreak % 10 === 0) {
              console.log(`[sql2014-sync] no SQL changes detected; skipping heavy sync (streak=${noChangeStreak})`);
            }
            isInitialCycle = false;
            return;
          }

          if (!token) {
            console.warn('[sql2014-sync] change-token query returned empty token; running full sync as fallback');
          }
        }

        const result = await syncCycle(pool, state, queryText, {
          suppressAutoPrint: isInitialCycle,
        });

        if (SQL_CHANGE_TOKEN_ENABLED) {
          const tokenAfterSync = await getChangeToken(pool, state, changeTokenQueryText);
          if (tokenAfterSync) {
            lastChangeToken = tokenAfterSync;
          }
        }

        if (result.processed === 0 && result.created === 0 && result.updated === 0 && result.skipped === 0) {
          noChangeStreak += 1;
          nextDelayMs = SQL_IDLE_POLL_INTERVAL_MS;
        } else {
          noChangeStreak = 0;
        }

        if (result.processed > 0 || result.skipped > 0) {
          console.log(
            `[sql2014-sync] processed=${result.processed} created=${result.created} updated=${result.updated} skipped=${result.skipped} lastSyncAt=${result.lastSyncAt}`
          );
        }
        isInitialCycle = false;
      } catch (error) {
        console.error('[sql2014-sync] cycle failed:', error.message || error);
        isInitialCycle = false;
      } finally {
        if (!stopped) {
          pollTimeoutHandle = setTimeout(runOnce, nextDelayMs);
        }
      }
    };

    await runOnce();
  })().catch(error => {
    console.error('[sql2014-sync] fatal error:', error.message || error);
  });

  return stop;
}

module.exports = { startSql2014Sync };
