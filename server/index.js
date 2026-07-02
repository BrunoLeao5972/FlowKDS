const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const path = require('path');
const RUNTIME_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
require('dotenv').config({ path: path.join(RUNTIME_DIR, '.env') });
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');
const { Server: IOServer } = require('socket.io');
const { connectMongo } = require('./mongo');
const Order = require('./models/Order');
const AuthConfig = require('./models/AuthConfig');
const RestaurantSettings = require('./models/RestaurantSettings');
const User = require('./models/User');
const Sector = require('./models/Sector');
const { createSaasRouter } = require('./saas/routes');
const { startSyncWorker } = require('./saas/syncWorker');
const { verifyAccessToken: verifySaasAccessToken } = require('./saas/auth');
const { printPedido } = require('./services/pedidoPrinter');

const app = express();
// Permite sobrescrever a porta via variável de ambiente.
const PORT = process.env.PORT || 8081;
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || true;
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
const AUTH_USERNAME = process.env.AUTH_USERNAME || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH || '';
const AUTH_PASSWORD_SALT = process.env.AUTH_PASSWORD_SALT || '';
const AUTH_RESET_CODE = process.env.AUTH_RESET_CODE || '';
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || `${AUTH_PASSWORD || 'kds'}-token-secret`;
const AUTH_TOKEN_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 12);
const LEGACY_TENANT_ID = process.env.LEGACY_TENANT_ID || 'legacy';
const ALL_PERMISSIONS = ['admin', 'kitchen', 'display', 'settings', 'reports'];
const PRINT_PEDIDO_AUTO_ENABLED = String(process.env.PRINT_PEDIDO_AUTO_ENABLED || 'false').trim().toLowerCase() === 'true';
const PRINT_PEDIDO_MODO = String(process.env.PRINT_PEDIDO_MODO || 'IMPRESSORA').trim().toUpperCase();
const PRINT_PEDIDO_IMPRESSORA = String(process.env.PRINT_PEDIDO_IMPRESSORA || '').trim();
const PRINT_PEDIDO_OUTPUT_DIR = String(process.env.PRINT_PEDIDO_OUTPUT_DIR || '').trim();
const FIXED_PRINT_SCALE = 115;
const DEFAULT_NEW_ORDER_SOUND = '/Songs/Efeito Sonoro - Novo Pedido.mp3';
const DEFAULT_READY_ORDER_SOUND = '/Songs/Efeito Sonoro - Painel de Retirada.mp3';
const DEFAULT_PANEL_CALL_SOUND = '/Songs/Efeito Sonoro - Chamada no Painel.mp3';
const REPORT_IDLE_BREAK_MINUTES = Number(process.env.REPORT_IDLE_BREAK_MINUTES || 180);

app.use(cors({ origin: CORS_ORIGIN }));
app.use(bodyParser.json());
app.use(morgan('dev'));

function parseBasicAuth(headerValue) {
  if (!headerValue || !headerValue.startsWith('Basic ')) return null;
  try {
    const encoded = headerValue.split(' ')[1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const splitIndex = decoded.indexOf(':');
    if (splitIndex === -1) return null;
    const username = decoded.slice(0, splitIndex);
    const password = decoded.slice(splitIndex + 1);
    return { username, password };
  } catch {
    return null;
  }
}

// Token assinado em formato simples payload.signature para cenário local/legado.
function toBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function createAccessToken(username) {
  const payload = {
    u: username,
    exp: Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  };
  const payloadString = JSON.stringify(payload);
  const payloadEncoded = toBase64Url(payloadString);
  const signature = crypto
    .createHmac('sha256', AUTH_TOKEN_SECRET)
    .update(payloadEncoded)
    .digest('base64url');
  return `${payloadEncoded}.${signature}`;
}

// Validação com timingSafeEqual para reduzir risco de comparação insegura.
function verifyAccessToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadEncoded, signature] = token.split('.');
  if (!payloadEncoded || !signature) return null;

  const expectedSignature = crypto
    .createHmac('sha256', AUTH_TOKEN_SECRET)
    .update(payloadEncoded)
    .digest('base64url');

  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (actualBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadEncoded));
    if (!payload?.u || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordDigest(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  return { salt, passwordHash };
}

function isValidPassword(password, salt, passwordHash) {
  const actual = hashPassword(password, salt);
  const actualBuf = Buffer.from(actual, 'hex');
  const expectedBuf = Buffer.from(passwordHash, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

async function getActiveAuthConfig() {
  const stored = await AuthConfig.findOne({ key: 'default' }).lean();
  if (stored) return stored;

  const hasLegacyPassword = !!AUTH_PASSWORD;
  const hasEnvPasswordDigest = !!AUTH_PASSWORD_HASH && !!AUTH_PASSWORD_SALT;
  if (!AUTH_USERNAME || (!hasLegacyPassword && !hasEnvPasswordDigest)) return null;

  return {
    username: AUTH_USERNAME,
    passwordHash: hasEnvPasswordDigest ? AUTH_PASSWORD_HASH : null,
    passwordSalt: hasEnvPasswordDigest ? AUTH_PASSWORD_SALT : null,
  };
}

function parseBearerToken(headerValue) {
  if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
  return headerValue.slice('Bearer '.length).trim();
}

async function isAuthorizedHeader(headerValue, token) {
  // Quando auth está desativada, mantém compatibilidade com ambientes de teste.
  if (!AUTH_ENABLED) return true;
  const activeAuth = await getActiveAuthConfig();
  if (!activeAuth) return false;
  const envUsername = String(activeAuth.username || '').toLowerCase();

  const bearerToken = parseBearerToken(headerValue);
  const signedToken = token || bearerToken;
  const tokenPayload = verifyAccessToken(signedToken);
  if (tokenPayload?.u) {
    const tokenUsername = String(tokenPayload.u).toLowerCase();
    if (tokenUsername === envUsername) return true;
    const tokenUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: tokenUsername }).lean();
    if (tokenUser) return true;
  }

  const parsed = parseBasicAuth(headerValue);
  if (!parsed) return false;

  if (parsed.username.toLowerCase() === envUsername) {
    if (!activeAuth.passwordHash || !activeAuth.passwordSalt) {
      return parsed.password === AUTH_PASSWORD;
    }
    return isValidPassword(parsed.password, activeAuth.passwordSalt, activeAuth.passwordHash)
      || (AUTH_PASSWORD ? parsed.password === AUTH_PASSWORD : false);
  }

  const dbUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: parsed.username.toLowerCase() });
  if (!dbUser) return false;
  return dbUser.comparePassword(parsed.password);
}

async function resolveAuthUser(headerValue, token) {
  const activeAuth = await getActiveAuthConfig();
  const envUsername = String(activeAuth?.username || '').toLowerCase();

  const bearerToken = parseBearerToken(headerValue);
  const signedToken = token || bearerToken;
  const tokenPayload = verifyAccessToken(signedToken);
  if (tokenPayload?.u) {
    const tokenUsername = String(tokenPayload.u).toLowerCase();
    if (tokenUsername === envUsername && activeAuth?.username) {
      return {
        username: String(activeAuth.username),
        permissions: ALL_PERMISSIONS,
          sectorIds: [],
      };
    }

    const tokenUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: tokenUsername }).lean();
    if (tokenUser) {
      return {
        username: tokenUser.username,
        permissions: normalizePermissions(tokenUser.permissions),
          sectorIds: tokenUser.sectorIds || [],
      };
    }
  }

  const parsed = parseBasicAuth(headerValue);
  if (!parsed) return null;
  const basicUsername = parsed.username.toLowerCase();

  if (basicUsername === envUsername && activeAuth?.username) {
    return {
      username: String(activeAuth.username),
      permissions: ALL_PERMISSIONS,
        sectorIds: [],
    };
  }

  const dbUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: basicUsername }).lean();
  if (!dbUser) return null;
  return {
    username: dbUser.username,
    permissions: normalizePermissions(dbUser.permissions),
      sectorIds: dbUser.sectorIds || [],
  };
}

async function authMiddleware(req, res, next) {
  const token = req.headers['x-kds-token'];
  const parsedToken = Array.isArray(token) ? token[0] : token;
  if (await isAuthorizedHeader(req.headers.authorization, parsedToken)) {
    req.authUser = await resolveAuthUser(req.headers.authorization, parsedToken);
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}

// Cria o servidor HTTP e anexa o Socket.IO para eventos em tempo real.
const server = http.createServer(app);
const io = new IOServer(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
  }
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    try {
      const claims = verifySaasAccessToken(token);
      socket.data.tenantId = claims.tenantId;
      socket.data.userId = claims.sub;
      return next();
    } catch {
      // Se o token SaaS falhar, tenta autenticação legada.
    }
  }
  if (await isAuthorizedHeader(socket.handshake.headers.authorization, token)) return next();
  return next(new Error('unauthorized'));
});

const VALID_STATUSES = ['received', 'preparing', 'ready', 'delivered', 'cancelled'];
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Matriz de transição de estados para impedir saltos inválidos de operação.
const ALLOWED_STATUS_TRANSITIONS = {
  received: ['preparing', 'cancelled'],
  preparing: ['received', 'ready', 'cancelled'],
  ready: ['preparing', 'delivered', 'cancelled'],
  delivered: ['ready'],
  cancelled: ['received'],
};

function canTransitionOrderStatus(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) return false;
  if (fromStatus === toStatus) return true;
  const allowedTargets = ALLOWED_STATUS_TRANSITIONS[fromStatus] || [];
  return allowedTargets.includes(toStatus);
}

function normalizeSectorIds(rawSectorIds) {
  if (!Array.isArray(rawSectorIds)) return [];
  const cleaned = rawSectorIds
    .map(value => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(cleaned)];
}

function normalizeServiceMode(rawServiceMode) {
  const normalized = String(rawServiceMode || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!normalized) return null;

  const map = {
    balcao: 'balcao',
    balcon: 'balcao',
    mesa: 'mesa',
    cartao: 'cartao',
    cartao_consumacao: 'cartao',
    delivery: 'delivery',
    entrega: 'delivery',
    encomenda: 'encomenda',
    servico: 'servico',
    apartamento: 'apartamento',
    // Compatibilidade com códigos numéricos vindos da integração SQL
    '1': 'balcao',
    '16': 'balcao',
    '2': 'mesa',
    '17': 'mesa',
    '3': 'cartao',
    '4': 'delivery',
    '5': 'encomenda',
  };

  return map[normalized] || null;
}

function normalizePermissions(rawPermissions) {
  if (!Array.isArray(rawPermissions)) return [...ALL_PERMISSIONS];
  const cleaned = rawPermissions
    .map(value => String(value || '').trim())
    .filter(Boolean);

  // Compatibilidade: permissao legada "cook" passa a ser tratada como "kitchen".
  if (cleaned.includes('cook') && !cleaned.includes('kitchen')) {
    cleaned.push('kitchen');
  }

  const filtered = cleaned.filter(permission => ALL_PERMISSIONS.includes(permission));
  return [...new Set(filtered)];
}

// Descobre um IPv4 local para facilitar o acesso em rede local.
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function toISO(o) {
  const toIsoOrUndefined = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  };

  return {
    ...o,
    createdAt: toIsoOrUndefined(o.createdAt) || new Date().toISOString(),
    updatedAt: toIsoOrUndefined(o.updatedAt) || new Date().toISOString(),
    acceptedAt: toIsoOrUndefined(o.acceptedAt),
    startedAt: toIsoOrUndefined(o.startedAt),
    finishedAt: toIsoOrUndefined(o.finishedAt),
    prepareStartedAt: toIsoOrUndefined(o.prepareStartedAt),
    readyAt: toIsoOrUndefined(o.readyAt),
    deliveredAt: toIsoOrUndefined(o.deliveredAt),
    cancelledAt: toIsoOrUndefined(o.cancelledAt),
    cancelAcknowledgedAt: toIsoOrUndefined(o.cancelAcknowledgedAt),
  };
}

function parseTimestamp(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  const asDate = Date.parse(String(raw));
  if (!Number.isNaN(asDate)) return asDate;
  return undefined;
}

function resolveTicketOrderNumber({ orderNumber, serviceMode, lancamentoId, externalId, launchCode }) {
  const mode = normalizeServiceMode(serviceMode);
  const numericOrderNumber = Number(orderNumber || 0);

  if (mode === 'balcao' || mode === 'delivery' || mode === 'encomenda') {
    const candidates = [lancamentoId, externalId, launchCode];
    for (const candidate of candidates) {
      const digits = String(candidate || '').replace(/\D/g, '');
      if (digits.length >= 3) {
        const pickupNumber = Number(digits.slice(-3));
        if (Number.isFinite(pickupNumber) && pickupNumber > 0) {
          return pickupNumber;
        }
      }
    }
  }

  return numericOrderNumber;
}

function normalizeStoredOrderItem(it) {
  return {
    id: crypto.randomUUID(),
    sourceItemKey: (() => {
      const rawSourceItemKey = it?.sourceItemKey ?? it?.sourceitemkey ?? it?.itemKey ?? it?.itemkey;
      if (rawSourceItemKey === undefined || rawSourceItemKey === null || rawSourceItemKey === '') return null;
      return String(rawSourceItemKey).trim();
    })(),
    name: String(it?.name || '').trim() || 'Item sem nome',
    quantity: Number(it?.quantity) > 0 ? Number(it.quantity) : 1,
    notes: String(it?.notes || '').trim(),
    sectorId: (() => {
      const rawSector = it?.sectorId ?? it?.sector ?? it?.setorId ?? it?.setorid ?? it?.setor;
      if (rawSector === undefined || rawSector === null || rawSector === '') return null;
      return String(rawSector).trim();
    })(),
    itemStatus: 'waiting',
  };
}

function getComparableOrderItem(it) {
  return {
    name: String(it?.name || '').trim(),
    quantity: Number(it?.quantity) > 0 ? Number(it.quantity) : 1,
    notes: String(it?.notes || '').trim(),
    sectorId: it?.sectorId ? String(it.sectorId).trim() : null,
  };
}

function areComparableItemsEqual(left, right) {
  return left.name === right.name
    && left.quantity === right.quantity
    && left.notes === right.notes
    && left.sectorId === right.sectorId;
}

function comparableOrderItemKey(it) {
  return JSON.stringify(it);
}

function buildStableCollisionSuffix(item) {
  const comparable = comparableOrderItemKey(getComparableOrderItem(item));
  return Buffer
    .from(comparable)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12)
    || 'dup';
}

function mergeIncomingOrderItems(existingItems, incomingItems) {
  const existingSourceKeys = new Set(
    existingItems
      .map(item => String(item?.sourceItemKey || '').trim())
      .filter(Boolean)
  );
  const incomingWithSourceKey = incomingItems.filter(item => String(item?.sourceItemKey || '').trim());

  if (incomingWithSourceKey.length > 0) {
    const mergedItems = [...existingItems];
    let appendedCount = 0;

    for (const incomingItem of incomingItems) {
      const sourceItemKey = String(incomingItem?.sourceItemKey || '').trim();
      if (!sourceItemKey) continue;

      if (existingSourceKeys.has(sourceItemKey)) {
        const hasSameItemWithSameKey = mergedItems.some(existingItem => {
          const existingSourceItemKey = String(existingItem?.sourceItemKey || '').trim();
          if (existingSourceItemKey !== sourceItemKey) return false;
          return areComparableItemsEqual(getComparableOrderItem(existingItem), getComparableOrderItem(incomingItem));
        });

        if (hasSameItemWithSameKey) {
          continue;
        }

        // Alguns ambientes SQL reutilizam itemSequence na mesma comanda.
        // Se a chave colidir mas o item for diferente, mantemos os dois para nao perder lancamento.
        // O sufixo eh deterministico para evitar multiplicacao em novos ciclos de sync.
        const dedupedSourceItemKey = `${sourceItemKey}#${buildStableCollisionSuffix(incomingItem)}`;
        const alreadyMergedCollision = mergedItems.some(existingItem => {
          const existingSourceItemKey = String(existingItem?.sourceItemKey || '').trim();
          if (existingSourceItemKey !== dedupedSourceItemKey) return false;
          return areComparableItemsEqual(getComparableOrderItem(existingItem), getComparableOrderItem(incomingItem));
        });

        if (alreadyMergedCollision) {
          continue;
        }

        mergedItems.push({
          ...incomingItem,
          sourceItemKey: dedupedSourceItemKey,
        });
        existingSourceKeys.add(dedupedSourceItemKey);
        appendedCount += 1;
        continue;
      }

      const fallbackIndex = mergedItems.findIndex(existingItem => {
        const existingSourceItemKey = String(existingItem?.sourceItemKey || '').trim();
        if (existingSourceItemKey) return false;
        return areComparableItemsEqual(getComparableOrderItem(existingItem), getComparableOrderItem(incomingItem));
      });

      if (fallbackIndex >= 0) {
        mergedItems[fallbackIndex] = {
          ...mergedItems[fallbackIndex],
          sourceItemKey,
        };
        existingSourceKeys.add(sourceItemKey);
        continue;
      }

      mergedItems.push(incomingItem);
      existingSourceKeys.add(sourceItemKey);
      appendedCount += 1;
    }

    const comparableMerged = mergedItems.map(getComparableOrderItem);
    const remainingComparableCounts = new Map();
    for (const comparableItem of comparableMerged) {
      const key = comparableOrderItemKey(comparableItem);
      remainingComparableCounts.set(key, Number(remainingComparableCounts.get(key) || 0) + 1);
    }

    for (const incomingItem of incomingItems) {
      const sourceItemKey = String(incomingItem?.sourceItemKey || '').trim();
      if (sourceItemKey) continue;

      const comparableIncoming = getComparableOrderItem(incomingItem);
      const key = comparableOrderItemKey(comparableIncoming);
      const available = Number(remainingComparableCounts.get(key) || 0);

      if (available > 0) {
        remainingComparableCounts.set(key, available - 1);
        continue;
      }

      mergedItems.push(incomingItem);
      appendedCount += 1;
    }

    return { mergedItems, appendedCount };
  }

  const comparableExisting = existingItems.map(getComparableOrderItem);
  const existingCountsByKey = new Map();
  for (const comparableItem of comparableExisting) {
    const key = comparableOrderItemKey(comparableItem);
    existingCountsByKey.set(key, Number(existingCountsByKey.get(key) || 0) + 1);
  }

  const itemsToAppend = [];
  for (const incomingItem of incomingItems) {
    const comparableIncoming = getComparableOrderItem(incomingItem);
    const key = comparableOrderItemKey(comparableIncoming);
    const available = Number(existingCountsByKey.get(key) || 0);

    if (available > 0) {
      existingCountsByKey.set(key, available - 1);
      continue;
    }

    itemsToAppend.push(incomingItem);
  }

  if (!itemsToAppend.length) {
    return { mergedItems: existingItems, appendedCount: 0 };
  }

  return {
    mergedItems: [...existingItems, ...itemsToAppend],
    appendedCount: itemsToAppend.length,
  };
}

function buildFallbackDemandId(externalId, sourceUpdatedAt) {
  const ext = String(externalId || '').trim();
  if (!ext) return null;

  if (sourceUpdatedAt !== undefined && sourceUpdatedAt !== null) {
    const asDate = new Date(sourceUpdatedAt);
    if (!Number.isNaN(asDate.getTime())) {
      return `${ext}::${asDate.toISOString()}`;
    }
  }

  return `${ext}:${Math.floor(Date.now() / 60000)}`;
}

function shouldForkTerminalOrder(existingOrder, incomingPayload) {
  if (!existingOrder || !['ready', 'delivered', 'cancelled'].includes(existingOrder.status)) {
    return false;
  }

  const existingComparableItems = JSON.stringify((existingOrder.items || []).map(getComparableOrderItem));
  const incomingComparableItems = JSON.stringify((incomingPayload.items || []).map(getComparableOrderItem));

  if (existingComparableItems !== incomingComparableItems) return true;

  const incomingSourceUpdatedAt = incomingPayload.sourceUpdatedAt;
  if (
    incomingSourceUpdatedAt !== undefined
    && incomingSourceUpdatedAt !== null
    && (existingOrder.lastSyncedAt == null || incomingSourceUpdatedAt > existingOrder.lastSyncedAt)
  ) {
    return true;
  }

  return false;
}

function buildCreatedAtMatch(fromRaw, toRaw) {
  const from = parseTimestamp(fromRaw);
  const to = parseTimestamp(toRaw);
  if (from === undefined || to === undefined) {
    return { error: 'invalid_from_or_to' };
  }
  if (from !== null && to !== null && from > to) {
    return { error: 'from_must_be_less_or_equal_to' };
  }

  if (from === null && to === null) {
    // Se nenhuma data foi especificada, usa o dia de hoje (00:00:00 até 23:59:59)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fromToday = today.getTime();
    
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);
    const toToday = endOfDay.getTime();
    
    return { match: { createdAt: { $gte: fromToday, $lte: toToday } } };
  }

  const createdAt = {};
  if (from !== null) createdAt.$gte = from;
  if (to !== null) createdAt.$lte = to;
  return { match: { createdAt } };
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function toMinutes(ms) {
  return ms / 60000;
}

function isSameLocalDay(tsA, tsB) {
  const a = new Date(tsA);
  const b = new Date(tsB);
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function toSafeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toSafeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toSafeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normalizeRestaurantPayload(payload) {
  const raw = payload || {};
  const printSize = ['58mm', '80mm', 'A4'].includes(String(raw.printSize || '').trim())
    ? String(raw.printSize).trim()
    : '80mm';
  const orderNumberMode = ['continuous', 'daily-reset', 'custom-start'].includes(String(raw.orderNumberMode || '').trim())
    ? String(raw.orderNumberMode).trim()
    : 'continuous';

  return {
    tempoMedio: toSafeNumber(raw.tempoMedio, 15),
    tempoAlerta: toSafeNumber(raw.tempoAlerta, 20),
    tempoCritico: toSafeNumber(raw.tempoCritico, 25),
    tradeName: toSafeString(raw.tradeName),
    legalName: toSafeString(raw.legalName),
    cnpj: toSafeString(raw.cnpj),
    cep: toSafeString(raw.cep),
    street: toSafeString(raw.street),
    number: toSafeString(raw.number),
    city: toSafeString(raw.city),
    complement: toSafeString(raw.complement),
    orderNumberMode,
    customStartNumber: toSafeNumber(raw.customStartNumber, 100),
    lastResetDate: raw.lastResetDate ? toSafeString(raw.lastResetDate) : null,
    licenseFileName: raw.licenseFileName === null ? null : (raw.licenseFileName ? toSafeString(raw.licenseFileName) : null),
    licenseContent: raw.licenseContent === null ? null : (raw.licenseContent ? String(raw.licenseContent) : null),
    newOrderSound: normalizeSoundSource(raw.newOrderSound, DEFAULT_NEW_ORDER_SOUND, 'new'),
    readyOrderSound: normalizeSoundSource(raw.readyOrderSound, DEFAULT_READY_ORDER_SOUND, 'ready'),
    newOrderSoundEnabled: toSafeBoolean(raw.newOrderSoundEnabled, true),
    readyOrderSoundEnabled: toSafeBoolean(raw.readyOrderSoundEnabled, true),
    panelCallSound: normalizeSoundSource(raw.panelCallSound, DEFAULT_PANEL_CALL_SOUND, 'panel'),
    panelCallSoundEnabled: toSafeBoolean(raw.panelCallSoundEnabled, true),
    printerName: toSafeString(raw.printerName),
    printSize,
    printScale: toSafeNumber(raw.printScale, 115),
    panelColor: raw.panelColor ? toSafeString(raw.panelColor) : '#FF6B35',
    animationsEnabled: toSafeBoolean(raw.animationsEnabled, true),
    enabledServiceModes: Array.isArray(raw.enabledServiceModes) 
      ? raw.enabledServiceModes.map(m => String(m).trim()).filter(Boolean)
      : [],
    panelEnabledServiceModes: Array.isArray(raw.panelEnabledServiceModes)
      ? raw.panelEnabledServiceModes.map(m => String(m).trim()).filter(Boolean)
      : [],
    autoPrep: toSafeBoolean(raw.autoPrep, false),
  };
}

function normalizeSoundSource(value, fallback, channel) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  if (raw === '/Songs/Efeito Sonoro - Chegou.mp3' || raw === '/Songs/Efeito Sonoro - Chegou Pedido.mp3') {
    return DEFAULT_NEW_ORDER_SOUND;
  }

  if (raw === '/Songs/Efeito Sonoro - Pedido Pronto.mp3') {
    return channel === 'panel' ? DEFAULT_PANEL_CALL_SOUND : DEFAULT_READY_ORDER_SOUND;
  }

  return raw;
}

function updateEnvFile(updates) {
  try {
    const envPath = path.join(RUNTIME_DIR, '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    }

    const lines = content.split('\n');
    const updatedKeys = new Set(Object.keys(updates));
    const newLines = [];

    // Atualiza linhas existentes ou substitui
    lines.forEach(line => {
      const trimmed = line.trim();
      const match = trimmed.match(/^([A-Z_]+)=/);
      if (match) {
        const key = match[1];
        if (updatedKeys.has(key)) {
          const value = updates[key] || '';
          const escaped = String(value).includes(' ') ? `"${value}"` : value;
          newLines.push(`${key}=${escaped}`);
          updatedKeys.delete(key);
        } else {
          newLines.push(line);
        }
      } else {
        newLines.push(line);
      }
    });

    // Adiciona chaves que não existiam
    updatedKeys.forEach(key => {
      const value = updates[key] || '';
      const escaped = String(value).includes(' ') ? `"${value}"` : value;
      newLines.push(`${key}=${escaped}`);
    });

    const newContent = newLines.join('\n').trim() + '\n';
    fs.writeFileSync(envPath, newContent, 'utf-8');
    console.log('[.env] Arquivo atualizado com sucesso');
    return true;
  } catch (err) {
    console.error('[.env] Erro ao atualizar arquivo:', err.message);
    return false;
  }
}

function buildTicketText(payload) {
  const now = new Date();
  const dateStr = now.toLocaleString('pt-BR');
  const orderNumber = String(payload.orderNumber || '').trim() || '-';
  const rawCustomerName = String(payload.customerName || '').trim();
  const customerName = !rawCustomerName
    || rawCustomerName.toLowerCase() === 'geral'
    || rawCustomerName.toLowerCase() === 'cliente sem cadastro'
    || rawCustomerName.toLowerCase() === 'cliente nao cadastrado'
    ? 'Cliente nao cadastrado'
    : rawCustomerName;
  const printerName = String(payload.printerName || '').trim() || 'Nao definida';
  const printSize = String(payload.printSize || '80mm').trim();
  return [
    'FOX KDS - SENHA DO PEDIDO',
    '================================',
    `Senha: ${orderNumber}`,
    `Cliente: ${customerName}`,
    `Data/Hora: ${dateStr}`,
    `Impressora: ${printerName}`,
    `Tamanho: ${printSize}`,
    '================================',
    '',
    'Atendimento Frente de Loja',
  ].join(os.EOL);
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.use('/saas', createSaasRouter(io));

app.post('/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const loginUsername = String(username || '').trim();

  if (!AUTH_ENABLED) return res.json({ token: null, enabled: false, permissions: ALL_PERMISSIONS });

  const activeAuth = await getActiveAuthConfig();
  if (!activeAuth) return res.status(500).json({ error: 'auth_not_configured' });

  // Tenta autenticar com o usuário principal (configurado no ambiente).
  if (loginUsername.toLowerCase() === String(activeAuth.username || '').toLowerCase()) {
    const validPassword = (activeAuth.passwordHash && activeAuth.passwordSalt
      ? isValidPassword(password, activeAuth.passwordSalt, activeAuth.passwordHash)
      : false)
      || (AUTH_PASSWORD ? password === AUTH_PASSWORD : false);

    if (!validPassword) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    return res.json({
      token: createAccessToken(activeAuth.username),
      enabled: true,
      permissions: ALL_PERMISSIONS,
    });
  }

  // Se não for o usuário principal, tenta autenticação por usuário do banco.
  const user = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: loginUsername.toLowerCase() });
  if (!user) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const passwordValid = await user.comparePassword(password);
  if (!passwordValid) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  return res.json({
    token: createAccessToken(user.username),
    enabled: true,
    permissions: normalizePermissions(user.permissions),
    sectorIds: user.sectorIds || [],
  });
}));

// Endpoints de usuários
app.get('/users', authMiddleware, asyncHandler(async (req, res) => {
  const users = await User.find({ tenantId: LEGACY_TENANT_ID }, 'username createdAt permissions sectorIds').sort({ createdAt: -1 }).lean();
  res.json(users.map(user => ({
    ...user,
    permissions: normalizePermissions(user.permissions),
  })));
}));

app.patch('/users/:id/permissions', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body || {};
  if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: 'permissions_must_be_array' });
  }
  const filtered = normalizePermissions(permissions);
  const user = await User.findByIdAndUpdate(id, { permissions: filtered }, { new: true, runValidators: true }).lean();
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  res.json({ id: user._id, username: user.username, permissions: normalizePermissions(user.permissions), sectorIds: user.sectorIds || [] });
}));

app.patch('/users/:id/sectors', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { sectorIds } = req.body || {};
  if (!Array.isArray(sectorIds)) {
    return res.status(400).json({ error: 'sector_ids_must_be_array' });
  }

  const normalizedSectorIds = normalizeSectorIds(sectorIds);
  const user = await User.findByIdAndUpdate(
    id,
    { sectorIds: normalizedSectorIds },
    { new: true, runValidators: true }
  ).lean();
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  res.json({ id: user._id, username: user.username, sectorIds: user.sectorIds || [] });
}));

app.post('/users', authMiddleware, asyncHandler(async (req, res) => {
  const { username, password, sectorIds } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username_and_password_required' });
  }
  const normalizedUsername = String(username || '').trim().toLowerCase();
  if (normalizedUsername === 'admin') {
    return res.status(400).json({ error: 'username_reserved' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'password_too_short' });
  }

  const existingUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: normalizedUsername }).lean();
  if (existingUser) {
    return res.status(409).json({ error: 'username_already_exists' });
  }

  const user = new User({
    tenantId: LEGACY_TENANT_ID,
    username: normalizedUsername,
    passwordHash: password,
    sectorIds: normalizeSectorIds(sectorIds),
  });
  await user.save();
  res.status(201).json({ id: user._id, username: user.username, createdAt: user.createdAt, permissions: normalizePermissions(user.permissions), sectorIds: user.sectorIds || [] });
}));

app.patch('/users/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body || {};

  const user = await User.findOne({ _id: id, tenantId: LEGACY_TENANT_ID });
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  if (username !== undefined) {
    const nextUsername = String(username || '').trim().toLowerCase();
    if (nextUsername.length < 3) {
      return res.status(400).json({ error: 'username_too_short' });
    }
    if (nextUsername === 'admin') {
      return res.status(400).json({ error: 'username_reserved' });
    }

    if (nextUsername !== user.username) {
      const existingUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: nextUsername, _id: { $ne: id } }).lean();
      if (existingUser) {
        return res.status(409).json({ error: 'username_already_exists' });
      }
      user.username = nextUsername;
    }
  }

  if (password !== undefined && password !== null && String(password).trim() !== '') {
    const nextPassword = String(password);
    if (nextPassword.length < 4) {
      return res.status(400).json({ error: 'password_too_short' });
    }
    user.passwordHash = nextPassword;
  }

  await user.save();

  return res.json({
    id: user._id,
    username: user.username,
    createdAt: user.createdAt,
    permissions: user.permissions || ALL_PERMISSIONS,
    sectorIds: user.sectorIds || [],
  });
}));

app.get('/settings/restaurant', authMiddleware, asyncHandler(async (req, res) => {
  const existing = await RestaurantSettings.findOne({ tenantId: LEGACY_TENANT_ID }).lean();
  if (!existing) {
    return res.json({
      tempoMedio: 15,
      tempoAlerta: 20,
      tempoCritico: 25,
      tradeName: '',
      legalName: '',
      cnpj: '',
      cep: '',
      street: '',
      number: '',
      city: '',
      complement: '',
      orderNumberMode: 'continuous',
      customStartNumber: 100,
      lastResetDate: null,
      licenseFileName: null,
      licenseContent: null,
      newOrderSound: DEFAULT_NEW_ORDER_SOUND,
      readyOrderSound: DEFAULT_READY_ORDER_SOUND,
      newOrderSoundEnabled: true,
      readyOrderSoundEnabled: true,
      panelCallSound: DEFAULT_PANEL_CALL_SOUND,
      panelCallSoundEnabled: true,
      printerName: '',
      printSize: '80mm',
      printScale: 115,
      panelColor: '#FF6B35',
      animationsEnabled: true,
      enabledServiceModes: [],
      panelEnabledServiceModes: ['balcao', 'delivery', 'encomenda'],
      autoPrep: false,
      updatedAt: null,
      updatedBy: null,
    });
  }

  return res.json({
    tempoMedio: existing.tempoMedio ?? 15,
    tempoAlerta: existing.tempoAlerta ?? 20,
    tempoCritico: existing.tempoCritico ?? 25,
    tradeName: existing.tradeName || '',
    legalName: existing.legalName || '',
    cnpj: existing.cnpj || '',
    cep: existing.cep || '',
    street: existing.street || '',
    number: existing.number || '',
    city: existing.city || '',
    complement: existing.complement || '',
    orderNumberMode: existing.orderNumberMode || 'continuous',
    customStartNumber: existing.customStartNumber ?? 100,
    lastResetDate: existing.lastResetDate || null,
    licenseFileName: existing.licenseFileName ?? null,
    licenseContent: existing.licenseContent ?? null,
    newOrderSound: normalizeSoundSource(existing.newOrderSound, DEFAULT_NEW_ORDER_SOUND, 'new'),
    readyOrderSound: normalizeSoundSource(existing.readyOrderSound, DEFAULT_READY_ORDER_SOUND, 'ready'),
    newOrderSoundEnabled: existing.newOrderSoundEnabled ?? true,
    readyOrderSoundEnabled: existing.readyOrderSoundEnabled ?? true,
    panelCallSound: normalizeSoundSource(existing.panelCallSound, DEFAULT_PANEL_CALL_SOUND, 'panel'),
    panelCallSoundEnabled: existing.panelCallSoundEnabled ?? true,
    printerName: existing.printerName || '',
    printSize: existing.printSize || '80mm',
    printScale: existing.printScale ?? 115,
    panelColor: existing.panelColor || '#FF6B35',
    animationsEnabled: existing.animationsEnabled ?? true,
    enabledServiceModes: existing.enabledServiceModes || [],
    panelEnabledServiceModes: existing.panelEnabledServiceModes || ['balcao', 'delivery', 'encomenda'],
    autoPrep: existing.autoPrep ?? false,
    updatedAt: existing.updatedAt || null,
    updatedBy: existing.updatedBy || null,
  });
}));

app.put('/settings/restaurant', authMiddleware, asyncHandler(async (req, res) => {
  const normalized = normalizeRestaurantPayload(req.body);
  const updatedBy = req.authUser?.username || null;

  const saved = await RestaurantSettings.findOneAndUpdate(
    { tenantId: LEGACY_TENANT_ID },
    {
      $set: {
        ...normalized,
        updatedBy,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  ).lean();

  // Atualiza .env se printerName foi fornecido
  if (normalized.printerName) {
    updateEnvFile({
      'PRINT_PEDIDO_IMPRESSORA': normalized.printerName,
    });
  }

  return res.json({
    tempoMedio: saved.tempoMedio ?? 15,
    tempoAlerta: saved.tempoAlerta ?? 20,
    tempoCritico: saved.tempoCritico ?? 25,
    tradeName: saved.tradeName || '',
    legalName: saved.legalName || '',
    cnpj: saved.cnpj || '',
    cep: saved.cep || '',
    street: saved.street || '',
    number: saved.number || '',
    city: saved.city || '',
    complement: saved.complement || '',
    orderNumberMode: saved.orderNumberMode || 'continuous',
    customStartNumber: saved.customStartNumber ?? 100,
    lastResetDate: saved.lastResetDate || null,
    licenseFileName: saved.licenseFileName ?? null,
    licenseContent: saved.licenseContent ?? null,
    newOrderSound: normalizeSoundSource(saved.newOrderSound, DEFAULT_NEW_ORDER_SOUND, 'new'),
    readyOrderSound: normalizeSoundSource(saved.readyOrderSound, DEFAULT_READY_ORDER_SOUND, 'ready'),
    newOrderSoundEnabled: saved.newOrderSoundEnabled ?? true,
    readyOrderSoundEnabled: saved.readyOrderSoundEnabled ?? true,
    panelCallSound: normalizeSoundSource(saved.panelCallSound, DEFAULT_PANEL_CALL_SOUND, 'panel'),
    panelCallSoundEnabled: saved.panelCallSoundEnabled ?? true,
    printerName: saved.printerName || '',
    printSize: saved.printSize || '80mm',
    printScale: saved.printScale ?? 115,
    panelColor: saved.panelColor || '#FF6B35',
    animationsEnabled: saved.animationsEnabled ?? true,
    enabledServiceModes: saved.enabledServiceModes || [],
    panelEnabledServiceModes: saved.panelEnabledServiceModes || ['balcao', 'delivery', 'encomenda'],
    autoPrep: saved.autoPrep ?? false,
    updatedAt: saved.updatedAt || null,
    updatedBy: saved.updatedBy || null,
  });
}));

app.post('/print/ticket', authMiddleware, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const mode = String(body.mode || 'HTML').toUpperCase();
  const orderNumber = Number(body.orderNumber || 0);
  const serviceMode = String(body.serviceMode || '').trim().toLowerCase() || null;
  const lancamentoId = String(body.lancamentoId ?? body.lancamentoid ?? '').trim() || null;
  const externalId = String(body.externalId ?? body.externalid ?? '').trim() || null;
  const launchCode = String(body.launchCode ?? body.launchcode ?? '').trim() || null;
  const effectiveOrderNumber = resolveTicketOrderNumber({
    orderNumber,
    serviceMode,
    lancamentoId,
    externalId,
    launchCode,
  });
  const printerName = String(body.printerName || '').trim();

  if (!['FILE', 'HTML', 'IMPRESSORA'].includes(mode)) {
    return res.status(400).json({ error: 'invalid_mode' });
  }

  if (!Number.isFinite(effectiveOrderNumber) || effectiveOrderNumber <= 0) {
    return res.status(400).json({ error: 'invalid_order_number' });
  }

  const result = await printPedido(effectiveOrderNumber, printerName, mode, {
    outputDir: PRINT_PEDIDO_OUTPUT_DIR || undefined,
    customerName: String(body.customerName || ''),
    serviceMode,
    attendant: String(body.attendant || '').trim(),
    sellerName: String(body.sellerName || '').trim(),
    tradeName: String(body.tradeName || ''),
    items: Array.isArray(body.items) ? body.items : [],
    printSize: String(body.printSize || '80mm'),
    printScale: FIXED_PRINT_SCALE,
  });

  if (!result.ok) {
    return res.status(400).json({
      error: 'print_failed',
      message: result.mensagem,
      detail: result.erroTecnico || null,
    });
  }

  return res.json({ ok: true, mode, filePath: result.arquivoGerado || null });
}));

app.delete('/users/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deleted = await User.findByIdAndDelete(id);
  if (!deleted) {
    return res.status(404).json({ error: 'user_not_found' });
  }
  res.status(204).end();
}));

// ── Setores ─────────────────────────────────────────────────────────────────

// Retorna todos os setores sincronizados do SQL (apenas ativos por padrão).
// Query param ?includeInactive=true retorna todos.
app.get('/sectors', authMiddleware, asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const filter = { tenantId: LEGACY_TENANT_ID };
  if (!includeInactive) {
    filter.isActive = true;
  }
  const sectors = await Sector.find(filter).sort({ sortOrder: 1, sectorId: 1 }).lean();
  res.json(sectors.map(s => ({ id: s.sectorId, name: s.name, sortOrder: s.sortOrder, isActive: s.isActive })));
}));

// Recebe a lista de setores enviada pelo bridge e faz upsert em massa.
app.post('/sectors/sync', authMiddleware, asyncHandler(async (req, res) => {
  const { sectors } = req.body || {};
  if (!Array.isArray(sectors)) return res.status(400).json({ error: 'sectors_must_be_array' });

  const ops = sectors.map((s, idx) => ({
    updateOne: {
      filter: { tenantId: LEGACY_TENANT_ID, sectorId: String(s.id) },
      update: { $set: { name: String(s.name || s.id), sortOrder: idx } },
      // Não sobrescreve isActive para não reativar setores desativados manualmente
      upsert: true,
    },
  }));

  if (ops.length) await Sector.bulkWrite(ops, { ordered: false });
  res.json({ synced: ops.length });
}));

// Ativa ou desativa um setor no KDS (sem excluir do SQL). Apenas admins.
app.patch('/sectors/:sectorId/activation', authMiddleware, asyncHandler(async (req, res) => {
  const { sectorId } = req.params;
  const { isActive } = req.body || {};

  // Verifica se é admin
  const authPermissions = req.authUser?.permissions || [];
  if (!authPermissions.includes('admin')) {
    return res.status(403).json({ error: 'admin_required' });
  }

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'isActive_must_be_boolean' });
  }

  const sector = await Sector.findOneAndUpdate(
    { tenantId: LEGACY_TENANT_ID, sectorId: String(sectorId) },
    { $set: { isActive } },
    { new: true, lean: true }
  );
  if (!sector) return res.status(404).json({ error: 'sector_not_found' });
  res.json({ id: sector.sectorId, name: sector.name, isActive: sector.isActive });
}));

// ── Pedidos ──────────────────────────────────────────────────────────────────

app.use('/orders', authMiddleware);

app.get('/orders', asyncHandler(async (req, res) => {
  // Traz apenas pedidos de hoje: evita carregar o histórico completo (milhares de
  // pedidos antigos) no snapshot inicial do KDS.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const orders = await Order.find({
    tenantId: LEGACY_TENANT_ID,
    createdAt: { $gte: startOfToday.getTime() },
  }).sort({ createdAt: 1 }).lean();
  res.json(orders.map(toISO));
}));

app.get('/orders/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await Order.findOne({ tenantId: LEGACY_TENANT_ID, id }).lean();
  if (!order) return res.status(404).json({ error: 'not_found' });
  res.json(toISO(order));
}));

app.get('/reports/operational', authMiddleware, asyncHandler(async (req, res) => {
  const authPermissions = req.authUser?.permissions || [];
  if (!authPermissions.includes('reports')) {
    return res.status(403).json({ error: 'reports_permission_required' });
  }

  const { match, error } = buildCreatedAtMatch(req.query.from, req.query.to);
  const scopedMatch = { ...match, tenantId: LEGACY_TENANT_ID };
  if (error) {
    return res.status(400).json({ error });
  }

  const slaMinutes = Number(req.query.slaMinutes || 20);
  if (!Number.isFinite(slaMinutes) || slaMinutes <= 0) {
    return res.status(400).json({ error: 'invalid_sla_minutes' });
  }

  const stageFields = [
    {
      $addFields: {
        createdDate: { $toDate: '$createdAt' },
        acceptedTs: { $ifNull: ['$acceptedAt', { $ifNull: ['$prepareStartedAt', '$createdAt'] }] },
        startedTs: { $ifNull: ['$startedAt', '$prepareStartedAt'] },
        finishedTs: { $ifNull: ['$finishedAt', '$readyAt'] },
        deliveredTs: '$deliveredAt',
        cancelledTs: {
          $cond: [
            { $eq: ['$status', 'cancelled'] },
            { $ifNull: ['$cancelledAt', '$updatedAt'] },
            null,
          ],
        },
        cookRef: { $ifNull: ['$cookId', 'unassigned'] },
      },
    },
  ];

  const [
    totalsByDay,
    totalsByWeek,
    totalsByMonth,
    ordersByHour,
    globalStageMetrics,
    productivityByCook,
    cancelByStage,
    timelineOrders,
  ] = await Promise.all([
    Order.aggregate([
      { $match: scopedMatch },
      {
        $group: {
          _id: {
            day: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: { $toDate: '$createdAt' },
              },
            },
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { '_id.day': 1 } },
      { $project: { _id: 0, day: '$_id.day', total: 1 } },
    ]),
    Order.aggregate([
      { $match: scopedMatch },
      {
        $group: {
          _id: {
            year: { $isoWeekYear: { $toDate: '$createdAt' } },
            week: { $isoWeek: { $toDate: '$createdAt' } },
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } },
      {
        $project: {
          _id: 0,
          year: '$_id.year',
          week: '$_id.week',
          total: 1,
        },
      },
    ]),
    Order.aggregate([
      { $match: scopedMatch },
      {
        $group: {
          _id: {
            year: { $year: { $toDate: '$createdAt' } },
            month: { $month: { $toDate: '$createdAt' } },
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      {
        $project: {
          _id: 0,
          year: '$_id.year',
          month: '$_id.month',
          total: 1,
        },
      },
    ]),
    Order.aggregate([
      { $match: scopedMatch },
      {
        $group: {
          _id: { $hour: { date: { $toDate: '$createdAt' } } },
          total: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, hour: '$_id', total: 1 } },
    ]),
    Order.aggregate([
      { $match: scopedMatch },
      ...stageFields,
      {
        $project: {
          status: 1,
          cookRef: 1,
          createdToAcceptedMin: {
            $cond: [
              { $and: [{ $ne: ['$acceptedTs', null] }, { $gt: ['$acceptedTs', '$createdAt'] }] },
              { $divide: [{ $subtract: ['$acceptedTs', '$createdAt'] }, 60000] },
              null,
            ],
          },
          acceptedToStartedMin: {
            $cond: [
              { $and: [{ $ne: ['$startedTs', null] }, { $ne: ['$acceptedTs', null] }, { $gt: ['$startedTs', '$acceptedTs'] }] },
              { $divide: [{ $subtract: ['$startedTs', '$acceptedTs'] }, 60000] },
              null,
            ],
          },
          startedToFinishedMin: {
            $cond: [
              { $and: [{ $ne: ['$startedTs', null] }, { $ne: ['$finishedTs', null] }, { $gt: ['$finishedTs', '$startedTs'] }] },
              { $divide: [{ $subtract: ['$finishedTs', '$startedTs'] }, 60000] },
              null,
            ],
          },
          prepTimeMin: {
            $cond: [
              { $and: [{ $ne: ['$startedTs', null] }, { $ne: ['$finishedTs', null] }, { $gt: ['$finishedTs', '$startedTs'] }] },
              { $divide: [{ $subtract: ['$finishedTs', '$startedTs'] }, 60000] },
              null,
            ],
          },
          waitBeforePrepMin: {
            $cond: [
              { $and: [{ $ne: ['$startedTs', null] }, { $gt: ['$startedTs', '$createdAt'] }] },
              { $divide: [{ $subtract: ['$startedTs', '$createdAt'] }, 60000] },
              null,
            ],
          },
          totalOrderTimeMin: {
            $cond: [
              { $and: [{ $ne: ['$deliveredTs', null] }, { $gt: ['$deliveredTs', '$createdAt'] }] },
              { $divide: [{ $subtract: ['$deliveredTs', '$createdAt'] }, 60000] },
              null,
            ],
          },
          isCancelled: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] },
          isSlaComparable: {
            $cond: [
              { $and: [{ $ne: ['$startedTs', null] }, { $ne: ['$finishedTs', null] }, { $gt: ['$finishedTs', '$startedTs'] }] },
              1,
              0,
            ],
          },
          isWithinSla: {
            $cond: [
              {
                $and: [
                  { $ne: ['$startedTs', null] },
                  { $ne: ['$finishedTs', null] },
                  { $lte: [{ $subtract: ['$finishedTs', '$startedTs'] }, slaMinutes * 60000] },
                ],
              },
              1,
              0,
            ],
          },
          isLate: {
            $cond: [
              {
                $and: [
                  { $ne: ['$startedTs', null] },
                  { $ne: ['$finishedTs', null] },
                  { $gt: [{ $subtract: ['$finishedTs', '$startedTs'] }, slaMinutes * 60000] },
                ],
              },
              1,
              0,
            ],
          },
          delayMinutes: {
            $cond: [
              {
                $and: [
                  { $ne: ['$startedTs', null] },
                  { $ne: ['$finishedTs', null] },
                  { $gt: [{ $subtract: ['$finishedTs', '$startedTs'] }, slaMinutes * 60000] },
                ],
              },
              {
                $divide: [
                  { $subtract: [{ $subtract: ['$finishedTs', '$startedTs'] }, slaMinutes * 60000] },
                  60000,
                ],
              },
              null,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          cancelledOrders: { $sum: '$isCancelled' },
          avgPrepTimeMin: { $avg: '$prepTimeMin' },
          avgCreatedToAcceptedMin: { $avg: '$createdToAcceptedMin' },
          avgAcceptedToStartedMin: { $avg: '$acceptedToStartedMin' },
          avgStartedToFinishedMin: { $avg: '$startedToFinishedMin' },
          avgWaitBeforePrepMin: { $avg: '$waitBeforePrepMin' },
          avgTotalOrderTimeMin: { $avg: '$totalOrderTimeMin' },
          slaComparableOrders: { $sum: '$isSlaComparable' },
          slaWithinOrders: { $sum: '$isWithinSla' },
          slaLateOrders: { $sum: '$isLate' },
          avgDelayMinutes: { $avg: '$delayMinutes' },
        },
      },
      { $project: { _id: 0 } },
    ]),
    Order.aggregate([
      { $match: scopedMatch },
      ...stageFields,
      {
        $project: {
          id: 1,
          number: 1,
          cookRef: 1,
          prepTimeMin: {
            $cond: [
              { $and: [{ $ne: ['$startedTs', null] }, { $ne: ['$finishedTs', null] }, { $gt: ['$finishedTs', '$startedTs'] }] },
              { $divide: [{ $subtract: ['$finishedTs', '$startedTs'] }, 60000] },
              null,
            ],
          },
          isLate: {
            $cond: [
              {
                $and: [
                  { $ne: ['$startedTs', null] },
                  { $ne: ['$finishedTs', null] },
                  { $gt: [{ $subtract: ['$finishedTs', '$startedTs'] }, slaMinutes * 60000] },
                ],
              },
              1,
              0,
            ],
          },
          hasPrepData: {
            $cond: [
              { $and: [{ $ne: ['$startedTs', null] }, { $ne: ['$finishedTs', null] }, { $gt: ['$finishedTs', '$startedTs'] }] },
              1,
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$cookRef',
          totalOrders: { $sum: 1 },
          orderIds: { $push: '$id' },
          orderNumbers: { $push: '$number' },
          avgPrepTimeMin: { $avg: '$prepTimeMin' },
          lateOrders: { $sum: '$isLate' },
          comparableOrders: { $sum: '$hasPrepData' },
        },
      },
      {
        $project: {
          _id: 0,
          cookId: '$_id',
          totalOrders: 1,
          orderIds: 1,
          orderNumbers: 1,
          avgPrepTimeMin: 1,
          lateOrders: 1,
          lateRatePct: {
            $cond: [
              { $gt: ['$comparableOrders', 0] },
              { $multiply: [{ $divide: ['$lateOrders', '$comparableOrders'] }, 100] },
              0,
            ],
          },
        },
      },
      { $sort: { totalOrders: -1, cookId: 1 } },
    ]),
    Order.aggregate([
      { $match: { ...scopedMatch, status: 'cancelled' } },
      ...stageFields,
      {
        $project: {
          cancelStage: {
            $switch: {
              branches: [
                { case: { $and: [{ $ne: ['$finishedTs', null] }, { $ne: ['$cancelledTs', null] }, { $gte: ['$cancelledTs', '$finishedTs'] }] }, then: 'after_finished' },
                { case: { $and: [{ $ne: ['$startedTs', null] }, { $ne: ['$cancelledTs', null] }, { $gte: ['$cancelledTs', '$startedTs'] }] }, then: 'during_preparing' },
                { case: { $and: [{ $ne: ['$acceptedTs', null] }, { $ne: ['$cancelledTs', null] }, { $gte: ['$cancelledTs', '$acceptedTs'] }] }, then: 'after_acceptance_before_preparing' },
              ],
              default: 'before_acceptance',
            },
          },
        },
      },
      { $group: { _id: '$cancelStage', total: { $sum: 1 } } },
      { $project: { _id: 0, stage: '$_id', total: 1 } },
      { $sort: { total: -1 } },
    ]),
    Order.find(scopedMatch, {
      id: 1,
      status: 1,
      createdAt: 1,
      updatedAt: 1,
      acceptedAt: 1,
      startedAt: 1,
      finishedAt: 1,
      prepareStartedAt: 1,
      readyAt: 1,
      deliveredAt: 1,
      cookId: 1,
      startedAtHistory: 1,
      stageEvents: 1,
    }).sort({ createdAt: 1 }).lean(),
  ]);

  const global = globalStageMetrics[0] || {
    totalOrders: 0,
    cancelledOrders: 0,
    avgPrepTimeMin: null,
    avgCreatedToAcceptedMin: null,
    avgAcceptedToStartedMin: null,
    avgStartedToFinishedMin: null,
    avgWaitBeforePrepMin: null,
    avgTotalOrderTimeMin: null,
    slaComparableOrders: 0,
    slaWithinOrders: 0,
    slaLateOrders: 0,
    avgDelayMinutes: null,
  };

  const cancelRatePct = global.totalOrders > 0
    ? (global.cancelledOrders / global.totalOrders) * 100
    : 0;

  const intervals = timelineOrders
    .map(order => {
      const started = order.startedAt || order.prepareStartedAt || null;
      const finished = order.finishedAt || order.readyAt || null;
      if (!started || !finished || finished <= started) return null;
      return { start: started, end: finished };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const idleBreakThresholdMs = (Number.isFinite(REPORT_IDLE_BREAK_MINUTES) && REPORT_IDLE_BREAK_MINUTES > 0
    ? REPORT_IDLE_BREAK_MINUTES
    : 180) * 60000;

  let idleTotalMs = 0;
  const idleGaps = [];
  let ignoredIdleGaps = 0;
  for (let i = 1; i < intervals.length; i += 1) {
    const gap = intervals[i].start - intervals[i - 1].end;
    if (gap <= 0) continue;

    const crossedDayBoundary = !isSameLocalDay(intervals[i - 1].end, intervals[i].start);
    const isLongBreak = gap > idleBreakThresholdMs;
    if (crossedDayBoundary || isLongBreak) {
      ignoredIdleGaps += 1;
      continue;
    }

    idleTotalMs += gap;
    idleGaps.push(gap);
  }

  const betweenOrders = [];
  let ignoredBetweenOrderGaps = 0;
  for (let i = 1; i < timelineOrders.length; i += 1) {
    const gap = timelineOrders[i].createdAt - timelineOrders[i - 1].createdAt;
    if (gap <= 0) continue;

    const crossedDayBoundary = !isSameLocalDay(timelineOrders[i - 1].createdAt, timelineOrders[i].createdAt);
    const isLongBreak = gap > idleBreakThresholdMs;
    if (crossedDayBoundary || isLongBreak) {
      ignoredBetweenOrderGaps += 1;
      continue;
    }

    betweenOrders.push(gap);
  }

  const sweepEvents = [];
  intervals.forEach(interval => {
    sweepEvents.push({ at: interval.start, delta: 1 });
    sweepEvents.push({ at: interval.end, delta: -1 });
  });
  sweepEvents.sort((a, b) => (a.at === b.at ? a.delta - b.delta : a.at - b.at));

  let concurrent = 0;
  let maxConcurrent = 0;
  let weightedConcurrentMs = 0;
  for (let i = 0; i < sweepEvents.length; i += 1) {
    concurrent += sweepEvents[i].delta;
    if (concurrent > maxConcurrent) maxConcurrent = concurrent;
    const next = sweepEvents[i + 1];
    if (!next) continue;
    const dt = next.at - sweepEvents[i].at;
    if (dt > 0) weightedConcurrentMs += concurrent * dt;
  }

  const timelineWindowMs = intervals.length
    ? intervals[intervals.length - 1].end - intervals[0].start
    : 0;
  const avgConcurrent = timelineWindowMs > 0
    ? weightedConcurrentMs / timelineWindowMs
    : 0;

  const uniqueCooks = new Set(
    timelineOrders
      .map(order => order.cookId)
      .filter(Boolean)
  );

  const avgPrepTimeMin = global.avgPrepTimeMin;
  const estimatedHourlyCapacity = avgPrepTimeMin && avgPrepTimeMin > 0
    ? maxConcurrent * (60 / avgPrepTimeMin)
    : null;

  const reprocessingOrders = timelineOrders.filter(order => {
    if (Array.isArray(order.startedAtHistory) && order.startedAtHistory.length > 1) return true;
    if (Array.isArray(order.stageEvents)) {
      const startedEvents = order.stageEvents.filter(evt => evt.status === 'preparing').length;
      return startedEvents > 1;
    }
    return false;
  });

  const cancelRateByStage = cancelByStage.map(item => ({
    stage: item.stage,
    total: item.total,
    ratePct: global.cancelledOrders > 0 ? (item.total / global.cancelledOrders) * 100 : 0,
  }));

  res.json({
    range: {
      from: req.query.from || null,
      to: req.query.to || null,
    },
    operationalReports: {
      totalsByPeriod: {
        daily: totalsByDay,
        weekly: totalsByWeek,
        monthly: totalsByMonth,
      },
      ordersByHour,
      preparation: {
        averagePrepTimeMin: global.avgPrepTimeMin,
        averageByStageMin: {
          createdToAccepted: global.avgCreatedToAcceptedMin,
          acceptedToStarted: global.avgAcceptedToStartedMin,
          startedToFinished: global.avgStartedToFinishedMin,
        },
      },
      cancellations: {
        totalCancelled: global.cancelledOrders,
        cancellationRatePct: cancelRatePct,
        byStage: cancelRateByStage,
      },
    },
    performanceMetrics: {
      slaMinutes,
      comparableOrders: global.slaComparableOrders,
      withinSlaOrders: global.slaWithinOrders,
      outsideSlaOrders: global.slaLateOrders,
      slaWithinPct: global.slaComparableOrders > 0 ? (global.slaWithinOrders / global.slaComparableOrders) * 100 : 0,
      slaOutsidePct: global.slaComparableOrders > 0 ? (global.slaLateOrders / global.slaComparableOrders) * 100 : 0,
      averageDelayMinutes: global.avgDelayMinutes,
      delayedOrders: global.slaLateOrders,
      averageWaitBeforePreparationMinutes: global.avgWaitBeforePrepMin,
    },
    teamProductivity: {
      byCook: productivityByCook,
      distributionByCook: productivityByCook.map(cook => ({
        cookId: cook.cookId,
        totalOrders: cook.totalOrders,
      })),
    },
    operationalEfficiency: {
      idleTimeTotalMinutes: toMinutes(idleTotalMs),
      idleTimeAverageMinutes: avg(idleGaps.map(toMinutes)),
      averageTimeBetweenOrdersMinutes: avg(betweenOrders.map(toMinutes)),
      idleBreakThresholdMinutes: idleBreakThresholdMs / 60000,
      ignoredIdleGaps,
      ignoredBetweenOrderGaps,
      simultaneousOrders: {
        max: maxConcurrent,
        average: avgConcurrent,
      },
      estimatedKitchenCapacityPerHour: estimatedHourlyCapacity,
      activeCooksInRange: uniqueCooks.size,
    },
    orderFlow: {
      averageTotalOrderTimeMinutes: global.avgTotalOrderTimeMin,
      reprocessing: {
        simulatedFromMultipleStarts: true,
        ordersWithReprocessing: reprocessingOrders.length,
        orderIds: reprocessingOrders.map(order => order.id),
      },
    },
  });
}));

// Publica o build do frontend quando existir (modo produção).
const DIST = process.pkg
  ? path.join(RUNTIME_DIR, 'dist')
  : path.resolve(__dirname, '../dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

app.post('/orders', asyncHandler(async (req, res) => {
  const { number, customerName, items, observations, cookId, suppressAutoPrint, sellerName } = req.body;
  const attendant = String(req.body?.attendant || req.body?.waiter || req.body?.garcom || req.body?.atendente || '').trim() || null;
  const lancamentoId = String(req.body?.lancamentoId ?? req.body?.lancamentoid ?? req.body?.launchId ?? '').trim() || null;
  const integratorId = String(req.body?.integratorId || '').trim() || null;
  const integratorName = String(req.body?.integratorName || '').trim() || null;
  const sourceUpdatedAt = parseTimestamp(req.body?.sourceUpdatedAt ?? req.body?.updatedAt);
  const serviceMode = normalizeServiceMode(
    req.body?.serviceMode
    ?? req.body?.modalidade
    ?? req.body?.modality
    ?? req.body?.attendanceMode
    ?? req.body?.tipoAtendimento
  );
  // number e items são obrigatórios; customerName pode ser vazio.
  if (!number || !Array.isArray(items)) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  // Valida se o serviceMode está habilitado
  if (serviceMode) {
    const settings = await RestaurantSettings.findOne({ tenantId: LEGACY_TENANT_ID }).lean();
    const enabledModes = settings?.enabledServiceModes || [];
    if (enabledModes.length > 0 && !enabledModes.includes(serviceMode)) {
      return res.status(400).json({ error: 'service_mode_not_enabled', message: `Modalidade "${serviceMode}" não está habilitada` });
    }
  }

  let normalizedIncomingItems = items.map(normalizeStoredOrderItem);
  let externalId = String(req.body?.externalid ?? req.body?.externalId ?? '').trim() || null;
  
  // Captura demandId (agrupador de itens lançados no mesmo momento)
  // Se não vier, gera fallback estável com externalId + sourceUpdatedAt.
  let demandId = String(req.body?.demandId ?? '').trim() || null;
  if (!demandId && externalId) {
    demandId = buildFallbackDemandId(externalId, sourceUpdatedAt);
  }
  
  if (externalId) {
    const identityQuery = demandId
      ? { tenantId: LEGACY_TENANT_ID, externalId, demandId }
      : { tenantId: LEGACY_TENANT_ID, externalId };

    const existingOrder = await Order.findOne({
      ...identityQuery,
    }).lean();

    if (existingOrder) {
      // Se já existe exatamente a mesma demanda, mantém idempotência.
      // Exceção: quando chegar novo lançamento para mesa/cartão já finalizado,
      // criamos nova demanda para abrir novo card e não misturar itens antigos.
      if (['ready', 'delivered', 'cancelled'].includes(existingOrder.status)) {
        const mustCreateFreshDemand = shouldForkTerminalOrder(existingOrder, {
          items: normalizedIncomingItems,
          sourceUpdatedAt,
        });

        if (!mustCreateFreshDemand) {
          return res.status(200).json(toISO(existingOrder));
        }

        demandId = buildFallbackDemandId(externalId, sourceUpdatedAt ?? Date.now());
      } else {
        // Pedido em andamento - mesclar itens normalmente
        const mergeResult = mergeIncomingOrderItems(existingOrder.items || [], normalizedIncomingItems);
        const appendedItemsCount = mergeResult.appendedCount;
        
        // Se é um novo lançamento para a mesma mesa/externalId, gerar novo demandId
        const newDemandId = demandId || (externalId 
          ? buildFallbackDemandId(externalId, sourceUpdatedAt)
          : existingOrder.demandId);
        
        const metadataPatch = {
          number,
          customerName: customerName || '',
          lancamentoId,
          serviceMode,
          attendant,
          integratorId,
          integratorName,
          sellerName: sellerName || null,
          observations: observations || '',
          demandId: newDemandId,
        };
        const metadataChanged = Object.entries(metadataPatch).some(([key, value]) => {
          const currentValue = existingOrder[key];
          return (currentValue ?? null) !== (value ?? null);
        });
        const itemsChanged = JSON.stringify(existingOrder.items || []) !== JSON.stringify(mergeResult.mergedItems);
        const shouldAdvanceSyncMarker = sourceUpdatedAt !== undefined
          && sourceUpdatedAt !== null
          && (existingOrder.lastSyncedAt == null || sourceUpdatedAt > existingOrder.lastSyncedAt);

        if (!itemsChanged && !metadataChanged && !shouldAdvanceSyncMarker) {
          return res.status(200).json(toISO(existingOrder));
        }

        const now = Date.now();
        const patch = {
          ...metadataPatch,
          updatedAt: now,
          syncVersion: Number(existingOrder.syncVersion || 1) + 1,
          lastSyncedAt: shouldAdvanceSyncMarker ? sourceUpdatedAt : existingOrder.lastSyncedAt,
        };

        if (itemsChanged) {
          patch.items = mergeResult.mergedItems;
        }

        const updatedOrder = await Order.findOneAndUpdate(
          { tenantId: LEGACY_TENANT_ID, id: existingOrder.id },
          patch,
          { new: true, lean: true }
        );

        io.emit('orders:updated', toISO(updatedOrder));
        return res.status(200).json(toISO(updatedOrder));
      }
    }
  }

  // Filtrar itens já entregues/cancelados em cards anteriores do mesmo externalId.
  // Evita contaminação quando o bridge reenvia todos os itens acumulados do SQL.
  if (externalId) {
    const deliveredOrders = await Order.find(
      { tenantId: LEGACY_TENANT_ID, externalId, status: { $in: ['delivered', 'cancelled'] } },
      { items: 1, id: 1, createdAt: 1 }
    ).lean();
    if (deliveredOrders.length > 0) {
      const deliveredKeys = new Set(
        deliveredOrders.flatMap(o => o.items || [])
          .map(i => String(i?.sourceItemKey || '').trim())
          .filter(Boolean)
      );
      const freshItems = normalizedIncomingItems.filter(item => {
        const key = String(item?.sourceItemKey || '').trim();
        return !key || !deliveredKeys.has(key);
      });
      if (freshItems.length === 0) {
        const latest = deliveredOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        return res.status(200).json(toISO(latest));
      }
      normalizedIncomingItems = freshItems;
    }
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const order = {
    tenantId: LEGACY_TENANT_ID,
    id,
    externalId,
    lancamentoId,
    demandId: demandId || null,
    number,
    customerName: customerName || '',
    serviceMode,
    attendant,
    integratorId,
    integratorName,
    sellerName: sellerName || null,
    observations: observations || '',
    status: 'received',
    createdAt: now,
    updatedAt: now,
    acceptedAt: null,
    startedAt: null,
    finishedAt: null,
    prepareStartedAt: null,
    readyAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelAcknowledgedAt: null,
    cookId: cookId || null,
    startedAtHistory: [],
    stageEvents: [{ status: 'received', at: now, cookId: cookId || null }],
    syncVersion: 1,
    lastSyncedAt: sourceUpdatedAt ?? now,
    items: normalizedIncomingItems,
  };

  await Order.create(order);
  res.status(201).json(toISO(order));
  io.emit('orders:created', toISO(order));

  const isMesaOrCartaoOrder = serviceMode === 'mesa' || serviceMode === 'cartao';

  if (PRINT_PEDIDO_AUTO_ENABLED && !suppressAutoPrint && !isMesaOrCartaoOrder) {
    const printOrderNumber = resolveTicketOrderNumber({
      orderNumber: order.number,
      serviceMode: order.serviceMode,
      lancamentoId: order.lancamentoId,
      externalId: order.externalId,
    });
    console.log(`[print-pedido] AUTO_ENABLED ativada - tentando imprimir pedido #${printOrderNumber}`);
    setImmediate(async () => {
      try {
        console.log(`[print-pedido] Buscando configurações do restaurante...`);
        const settings = await RestaurantSettings.findOne({ tenantId: LEGACY_TENANT_ID }).lean() || {};
        const tradeName = settings.tradeName || '';
        const printSize = settings.printSize || '80mm';
        const printScale = FIXED_PRINT_SCALE;
        console.log(`[print-pedido] Settings encontradas: tradeName="${tradeName}", printSize="${printSize}", printScale=${printScale}`);

        const printResult = await printPedido(
          printOrderNumber,
          PRINT_PEDIDO_IMPRESSORA,
          PRINT_PEDIDO_MODO,
          {
            outputDir: PRINT_PEDIDO_OUTPUT_DIR || undefined,
            customerName: order.customerName || '',
            serviceMode: order.serviceMode || null,
            attendant: order.attendant || null,
            sellerName: order.sellerName || null,
            tradeName,
            items: order.items || [],
            printSize,
            printScale,
          }
        );

        if (!printResult.ok) {
          console.warn(
            `[print-pedido] Falha no pedido ${order.number}: ${printResult.mensagem}`
            + (printResult.erroTecnico ? ` | detalhe: ${printResult.erroTecnico}` : '')
          );
          return;
        }

        console.log(
          `[print-pedido] Pedido ${printOrderNumber} impresso em modo ${PRINT_PEDIDO_MODO}`
          + (printResult.arquivoGerado ? ` | arquivo: ${printResult.arquivoGerado}` : '')
        );
      } catch (err) {
        console.error('[print-pedido] Erro na impressão automática:', err.message);
      }
    });
  } else if (PRINT_PEDIDO_AUTO_ENABLED && suppressAutoPrint) {
    console.log(`[print-pedido] Impressao automatica ignorada no pedido #${order.number} (suppressAutoPrint=true)`);
  } else if (PRINT_PEDIDO_AUTO_ENABLED && isMesaOrCartaoOrder) {
    console.log(`[print-pedido] Impressao automatica ignorada no pedido #${order.number} (serviceMode=${serviceMode})`);
  }
}));

// Atualiza o status individual de um item dentro de um pedido.
app.patch('/orders/:id/items/:itemId/status', asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { itemStatus, itemIndex } = req.body || {};
  const VALID_ITEM_STATUSES = ['waiting', 'preparing', 'ready'];
  if (!itemStatus || !VALID_ITEM_STATUSES.includes(itemStatus)) {
    return res.status(400).json({ error: 'invalid_item_status' });
  }

  const order = await Order.findOne({ tenantId: LEGACY_TENANT_ID, id }).lean();
  if (!order) return res.status(404).json({ error: 'not_found' });

  const parsedItemIndex = Number(itemIndex);
  const hasValidItemIndex = Number.isInteger(parsedItemIndex)
    && parsedItemIndex >= 0
    && parsedItemIndex < order.items.length;

  const targetIndex = hasValidItemIndex
    ? parsedItemIndex
    : order.items.findIndex(it => it.id === itemId);

  if (targetIndex === -1) return res.status(404).json({ error: 'item_not_found' });

  // Captura o username do usuário autenticado que está mudando o status do item
  const authPermissions = req.authUser?.permissions || [];
  const actorCookId = authPermissions.includes('kitchen') ? req.authUser?.username : null;
  const resolvedCookId = actorCookId || order.cookId || null;

  const now = Date.now();
  const updatedItems = order.items.map((it, idx) =>
    idx === targetIndex ? { ...it, itemStatus } : it
  );

  const normalizedItemStatuses = updatedItems.map(it => {
    if (it.itemStatus === 'ready') return 'ready';
    if (it.itemStatus === 'preparing') return 'preparing';
    return 'waiting';
  });

  const allItemsReady = normalizedItemStatuses.length > 0 && normalizedItemStatuses.every(status => status === 'ready');
  const anyItemInProgress = normalizedItemStatuses.some(status => status === 'preparing' || status === 'ready');

  let derivedOrderStatus = order.status;
  if (order.status !== 'cancelled' && order.status !== 'delivered') {
    // Se todos os itens estão prontos, o pedido vai para "ready" automaticamente.
    // Caso contrário, deriva entre received <-> preparing conforme progresso.
    if (allItemsReady) {
      derivedOrderStatus = 'ready';
    } else if (anyItemInProgress) {
      derivedOrderStatus = 'preparing';
    } else {
      derivedOrderStatus = 'received';
    }
  }

  const patch = {
    items: updatedItems,
    updatedAt: now,
    status: derivedOrderStatus,
  };

  if (derivedOrderStatus === 'preparing') {
    if (!order.acceptedAt) patch.acceptedAt = now;
    if (!order.startedAt) patch.startedAt = now;
    if (!order.prepareStartedAt) patch.prepareStartedAt = now;
    if (order.status !== 'preparing') {
      patch.startedAtHistory = [...(order.startedAtHistory || []), now];
    }
    // Atualiza o cookId quando um item é marcado como em preparo
    if (resolvedCookId && !order.cookId) patch.cookId = resolvedCookId;
  }

  if (derivedOrderStatus === 'ready' && !order.readyAt) {
    patch.readyAt = now;
  }

  if (derivedOrderStatus !== order.status) {
    patch.stageEvents = [
      ...(order.stageEvents || []),
      { status: derivedOrderStatus, at: now, cookId: resolvedCookId },
    ];
  }

  const updated = await Order.findOneAndUpdate(
    { tenantId: LEGACY_TENANT_ID, id },
    patch,
    { new: true, lean: true }
  );
  if (!updated) return res.status(404).json({ error: 'not_found' });
  io.emit('orders:updated', toISO(updated));
  return res.json(toISO(updated));
}));

app.patch('/orders/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, cookId } = req.body;
  if (!status) return res.status(400).json({ error: 'missing_status' });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' });

  const order = await Order.findOne({ tenantId: LEGACY_TENANT_ID, id }).lean();
  if (!order) return res.status(404).json({ error: 'not_found' });

  if (!canTransitionOrderStatus(order.status, status)) {
    return res.status(409).json({
      error: 'invalid_status_transition',
      from: order.status,
      to: status,
      allowed: ALLOWED_STATUS_TRANSITIONS[order.status] || [],
    });
  }

  const authPermissions = req.authUser?.permissions || [];
  const actorCookId = authPermissions.includes('kitchen') ? req.authUser?.username : null;
  const resolvedCookId = actorCookId || (cookId ? String(cookId) : (order.cookId || null));

  // Somente usuários com setor em comum podem iniciar preparo (admin ignora regra).
  if (status === 'preparing' && !authPermissions.includes('admin')) {
    const userSectorIds = normalizeSectorIds(req.authUser?.sectorIds || []);
    const orderSectorIds = normalizeSectorIds((order.items || []).map(item => item.sectorId));

    if (!userSectorIds.length) {
      return res.status(403).json({ error: 'user_without_sector' });
    }

    if (orderSectorIds.length > 0) {
      const hasAllowedSector = orderSectorIds.some(sectorId => userSectorIds.includes(sectorId));
      if (!hasAllowedSector) {
        return res.status(403).json({ error: 'sector_not_allowed' });
      }
    }
  }

  const now = Date.now();
  const patch = { status, updatedAt: now };
  if (status === 'received') {
    patch.items = (order.items || []).map(it => ({ ...it, itemStatus: 'waiting' }));
  }
  if (status === 'preparing') {
    if (!order.acceptedAt) patch.acceptedAt = now;
    if (!order.startedAt) patch.startedAt = now;
    if (!order.prepareStartedAt) patch.prepareStartedAt = now;
    patch.startedAtHistory = [...(order.startedAtHistory || []), now];
    if (resolvedCookId) patch.cookId = resolvedCookId;
  }
  if (status === 'ready') {
    if (!order.finishedAt) patch.finishedAt = now;
    if (!order.readyAt) patch.readyAt = now;
  }
  if (status === 'delivered' && !order.deliveredAt) patch.deliveredAt = now;
  if (status === 'cancelled') {
    if (!order.cancelledAt) patch.cancelledAt = now;
    if (order.cancelAcknowledgedAt) patch.cancelAcknowledgedAt = null;
  }
  if (!patch.cookId && cookId) patch.cookId = String(cookId);

  patch.stageEvents = [
    ...(order.stageEvents || []),
    { status, at: now, cookId: resolvedCookId || null },
  ];

  const updated = await Order.findOneAndUpdate({ tenantId: LEGACY_TENANT_ID, id }, patch, { new: true, lean: true });
  res.json(toISO(updated));
  io.emit('orders:updated', toISO(updated));
}));

app.patch('/orders/:id/cancel-ack', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await Order.findOne({ tenantId: LEGACY_TENANT_ID, id }).lean();
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (order.status !== 'cancelled') {
    return res.status(400).json({ error: 'order_not_cancelled' });
  }

  const now = Date.now();
  const patch = {
    updatedAt: now,
    cancelAcknowledgedAt: now,
  };
  if (!order.cancelledAt) patch.cancelledAt = now;

  const updated = await Order.findOneAndUpdate({ tenantId: LEGACY_TENANT_ID, id }, patch, { new: true, lean: true });
  res.json(toISO(updated));
  io.emit('orders:updated', toISO(updated));
}));

// Atualização completa (campos selecionados) de um pedido.
app.put('/orders/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await Order.findOne({ tenantId: LEGACY_TENANT_ID, id }).lean();
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const { number, customerName, items, observations, status, cookId } = req.body;
  const attendant = req.body?.attendant !== undefined
    ? (String(req.body.attendant || '').trim() || null)
    : existing.attendant;
  const hasServiceModePayload = [
    'serviceMode',
    'modalidade',
    'modality',
    'attendanceMode',
    'tipoAtendimento',
  ].some(key => Object.prototype.hasOwnProperty.call(req.body || {}, key));

  const serviceMode = hasServiceModePayload
    ? normalizeServiceMode(
      req.body?.serviceMode
      ?? req.body?.modalidade
      ?? req.body?.modality
      ?? req.body?.attendanceMode
      ?? req.body?.tipoAtendimento
    )
    : (existing.serviceMode || null);

  if (serviceMode) {
    const settings = await RestaurantSettings.findOne({ tenantId: LEGACY_TENANT_ID }).lean();
    const enabledModes = settings?.enabledServiceModes || [];
    if (enabledModes.length > 0 && !enabledModes.includes(serviceMode)) {
      return res.status(400).json({ error: 'service_mode_not_enabled', message: `Modalidade "${serviceMode}" não está habilitada` });
    }
  }

  if (typeof number !== 'number' || !customerName || !Array.isArray(items)) {
    return res.status(400).json({ error: 'invalid_payload' });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  const nextStatus = status || existing.status;
  if (!canTransitionOrderStatus(existing.status, nextStatus)) {
    return res.status(409).json({
      error: 'invalid_status_transition',
      from: existing.status,
      to: nextStatus,
      allowed: ALLOWED_STATUS_TRANSITIONS[existing.status] || [],
    });
  }

  const now = Date.now();
  const patch = {
    number,
    customerName,
    serviceMode,
    attendant,
    items: items.map((it, idx) => {
      const existingItem = Array.isArray(existing.items) ? existing.items[idx] : null;
      const rawSector = it.sectorId ?? it.sector ?? it.setorId ?? it.setorid ?? it.setor ?? existingItem?.sectorId;
      const normalizedSector = rawSector === undefined || rawSector === null || rawSector === ''
        ? null
        : String(rawSector).trim();

      const normalizedItemStatus = nextStatus === 'received'
        ? 'waiting'
        : (it.itemStatus || existingItem?.itemStatus || 'waiting');

      return {
        id: it.id || existingItem?.id || crypto.randomUUID(),
        name: it.name,
        quantity: it.quantity || 1,
        notes: it.notes || '',
        sectorId: normalizedSector,
        itemStatus: normalizedItemStatus,
      };
    }),
    observations: observations || '',
    status: nextStatus,
    updatedAt: now,
    cookId: cookId || existing.cookId || null,
  };

  // Ajusta timestamps quando há troca de status.
  if (patch.status === 'preparing') {
    if (!existing.acceptedAt) patch.acceptedAt = now;
    if (!existing.startedAt) patch.startedAt = now;
    if (!existing.prepareStartedAt) patch.prepareStartedAt = now;
    patch.startedAtHistory = [...(existing.startedAtHistory || []), now];
  }
  if (patch.status === 'ready') {
    if (!existing.finishedAt) patch.finishedAt = now;
    if (!existing.readyAt) patch.readyAt = now;
  }
  if (patch.status === 'delivered' && !existing.deliveredAt) patch.deliveredAt = now;
  if (patch.status === 'cancelled') {
    if (!existing.cancelledAt) patch.cancelledAt = now;
    if (existing.cancelAcknowledgedAt) patch.cancelAcknowledgedAt = null;
  }

  if ((status || existing.status) !== existing.status) {
    patch.stageEvents = [
      ...(existing.stageEvents || []),
      { status: patch.status, at: now, cookId: patch.cookId || null },
    ];
  }

  const updated = await Order.findOneAndUpdate({ tenantId: LEGACY_TENANT_ID, id }, patch, { new: true, lean: true });
  res.json(toISO(updated));
}));

app.delete('/orders/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deleted = await Order.findOneAndDelete({ tenantId: LEGACY_TENANT_ID, id }).lean();
  if (!deleted) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
  io.emit('orders:deleted', { id });
}));

// Tratamento centralizado para erros não tratados nas rotas assíncronas.
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'internal_error' });
});

// Logs de conexão do Socket.IO.
io.on('connection', socket => {
  if (socket.data?.tenantId) {
    socket.join(`tenant:${String(socket.data.tenantId)}`);
  }
  console.log('socket connected', socket.id);
  socket.on('disconnect', () => console.log('socket disconnected', socket.id));
});

async function start() {
  try {
    await connectMongo();
    startSyncWorker(io);
    server.listen(PORT, HOST, () => {
      const ip = getLocalIp();
      console.log(`KDS server listening on http://${ip}:${PORT} (bind ${HOST})`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

start();
