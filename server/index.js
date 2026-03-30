const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
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
const AUTH_RESET_CODE = process.env.AUTH_RESET_CODE || '';
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || `${AUTH_PASSWORD || 'kds'}-token-secret`;
const AUTH_TOKEN_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 12);
const LEGACY_TENANT_ID = process.env.LEGACY_TENANT_ID || 'legacy';
const ALL_PERMISSIONS = ['admin', 'kitchen', 'display', 'settings', 'cook'];
const PRINT_PEDIDO_AUTO_ENABLED = String(process.env.PRINT_PEDIDO_AUTO_ENABLED || 'false').trim().toLowerCase() === 'true';
const PRINT_PEDIDO_MODO = String(process.env.PRINT_PEDIDO_MODO || 'IMPRESSORA').trim().toUpperCase();
const PRINT_PEDIDO_IMPRESSORA = String(process.env.PRINT_PEDIDO_IMPRESSORA || '').trim();
const PRINT_PEDIDO_OUTPUT_DIR = String(process.env.PRINT_PEDIDO_OUTPUT_DIR || '').trim();

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
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(passwordHash, 'hex'));
}

async function getActiveAuthConfig() {
  const stored = await AuthConfig.findOne({ key: 'default' }).lean();
  if (stored) return stored;

  if (!AUTH_USERNAME || !AUTH_PASSWORD) return null;
  return {
    username: AUTH_USERNAME,
    passwordHash: null,
    passwordSalt: null,
  };
}

function parseBearerToken(headerValue) {
  if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
  return headerValue.slice('Bearer '.length).trim();
}

async function isAuthorizedHeader(headerValue, token) {
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
      || parsed.password === AUTH_PASSWORD;
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
      };
    }

    const tokenUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: tokenUsername }).lean();
    if (tokenUser) {
      return {
        username: tokenUser.username,
        permissions: tokenUser.permissions || [],
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
    };
  }

  const dbUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: basicUsername }).lean();
  if (!dbUser) return null;
  return {
    username: dbUser.username,
    permissions: dbUser.permissions || [],
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

// Tenta descobrir um IPv4 local para facilitar o log de inicialização.
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
  return {
    ...o,
    createdAt: new Date(o.createdAt).toISOString(),
    updatedAt: new Date(o.updatedAt).toISOString(),
    acceptedAt: o.acceptedAt ? new Date(o.acceptedAt).toISOString() : undefined,
    startedAt: o.startedAt ? new Date(o.startedAt).toISOString() : undefined,
    finishedAt: o.finishedAt ? new Date(o.finishedAt).toISOString() : undefined,
    prepareStartedAt: o.prepareStartedAt ? new Date(o.prepareStartedAt).toISOString() : undefined,
    readyAt: o.readyAt ? new Date(o.readyAt).toISOString() : undefined,
    deliveredAt: o.deliveredAt ? new Date(o.deliveredAt).toISOString() : undefined,
    cancelledAt: o.cancelledAt ? new Date(o.cancelledAt).toISOString() : undefined,
    cancelAcknowledgedAt: o.cancelAcknowledgedAt ? new Date(o.cancelAcknowledgedAt).toISOString() : undefined,
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
    return { match: {} };
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

function toSafeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeRestaurantPayload(payload) {
  const raw = payload || {};
  return {
    tradeName: toSafeString(raw.tradeName),
    legalName: toSafeString(raw.legalName),
    cnpj: toSafeString(raw.cnpj),
    cep: toSafeString(raw.cep),
    street: toSafeString(raw.street),
    number: toSafeString(raw.number),
    city: toSafeString(raw.city),
    complement: toSafeString(raw.complement),
  };
}

function buildTicketText(payload) {
  const now = new Date();
  const dateStr = now.toLocaleString('pt-BR');
  const orderNumber = String(payload.orderNumber || '').trim() || '-';
  const customerName = String(payload.customerName || '').trim() || '-';
  const printerName = String(payload.printerName || '').trim() || 'Nao definida';
  const printSize = String(payload.printSize || '80mm').trim();
  return [
    'FLOW KDS - SENHA DO PEDIDO',
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
      || password === AUTH_PASSWORD;

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
    permissions: user.permissions || ALL_PERMISSIONS,
  });
}));

// Endpoints de usuários
app.get('/users', authMiddleware, asyncHandler(async (req, res) => {
  const users = await User.find({ tenantId: LEGACY_TENANT_ID }, 'username createdAt permissions').sort({ createdAt: -1 }).lean();
  res.json(users);
}));

app.patch('/users/:id/permissions', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body || {};
  if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: 'permissions_must_be_array' });
  }
  const VALID_PERMS = ALL_PERMISSIONS;
  const filtered = permissions.filter(p => VALID_PERMS.includes(p));
  const user = await User.findByIdAndUpdate(id, { permissions: filtered }, { new: true, runValidators: true }).lean();
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  res.json({ id: user._id, username: user.username, permissions: user.permissions });
}));

app.post('/users', authMiddleware, asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username_and_password_required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password_too_short' });
  }

  const existingUser = await User.findOne({ tenantId: LEGACY_TENANT_ID, username: username.toLowerCase() }).lean();
  if (existingUser) {
    return res.status(409).json({ error: 'username_already_exists' });
  }

  const user = new User({
    tenantId: LEGACY_TENANT_ID,
    username: username.toLowerCase(),
    passwordHash: password,
  });
  await user.save();
  res.status(201).json({ id: user._id, username: user.username, createdAt: user.createdAt });
}));

app.get('/settings/restaurant', authMiddleware, asyncHandler(async (req, res) => {
  const existing = await RestaurantSettings.findOne({ tenantId: LEGACY_TENANT_ID }).lean();
  if (!existing) {
    return res.json({
      tradeName: '',
      legalName: '',
      cnpj: '',
      cep: '',
      street: '',
      number: '',
      city: '',
      complement: '',
      updatedAt: null,
      updatedBy: null,
    });
  }

  return res.json({
    tradeName: existing.tradeName || '',
    legalName: existing.legalName || '',
    cnpj: existing.cnpj || '',
    cep: existing.cep || '',
    street: existing.street || '',
    number: existing.number || '',
    city: existing.city || '',
    complement: existing.complement || '',
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

  return res.json({
    tradeName: saved.tradeName || '',
    legalName: saved.legalName || '',
    cnpj: saved.cnpj || '',
    cep: saved.cep || '',
    street: saved.street || '',
    number: saved.number || '',
    city: saved.city || '',
    complement: saved.complement || '',
    updatedAt: saved.updatedAt || null,
    updatedBy: saved.updatedBy || null,
  });
}));

app.post('/print/ticket', authMiddleware, asyncHandler(async (req, res) => {
  const mode = String(req.body?.mode || 'HTML').toUpperCase();
  if (mode !== 'FILE') {
    return res.json({ ok: true, mode: 'HTML' });
  }

  if (process.platform !== 'win32') {
    return res.status(400).json({ error: 'file_mode_requires_windows' });
  }

  const content = buildTicketText(req.body || {});
  const tempDir = path.join(os.tmpdir(), 'flow-kds-print');
  fs.mkdirSync(tempDir, { recursive: true });
  const fileName = `senha-${Date.now()}.txt`;
  const filePath = path.join(tempDir, fileName);
  fs.writeFileSync(filePath, content, 'utf8');

  const child = spawn('notepad.exe', [filePath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  return res.json({ ok: true, mode: 'FILE', filePath });
}));

app.delete('/users/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deleted = await User.findByIdAndDelete(id);
  if (!deleted) {
    return res.status(404).json({ error: 'user_not_found' });
  }
  res.status(204).end();
}));

app.use('/orders', authMiddleware);

app.get('/orders', asyncHandler(async (req, res) => {
  const orders = await Order.find({ tenantId: LEGACY_TENANT_ID }).sort({ createdAt: 1 }).lean();
  res.json(orders.map(toISO));
}));

app.get('/orders/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const order = await Order.findOne({ tenantId: LEGACY_TENANT_ID, id }).lean();
  if (!order) return res.status(404).json({ error: 'not_found' });
  res.json(toISO(order));
}));

app.get('/reports/operational', authMiddleware, asyncHandler(async (req, res) => {
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

  let idleTotalMs = 0;
  const idleGaps = [];
  for (let i = 1; i < intervals.length; i += 1) {
    const gap = intervals[i].start - intervals[i - 1].end;
    if (gap > 0) {
      idleTotalMs += gap;
      idleGaps.push(gap);
    }
  }

  const betweenOrders = [];
  for (let i = 1; i < timelineOrders.length; i += 1) {
    const gap = timelineOrders[i].createdAt - timelineOrders[i - 1].createdAt;
    if (gap > 0) betweenOrders.push(gap);
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
const DIST = path.resolve(__dirname, '../dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => {
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

app.post('/orders', asyncHandler(async (req, res) => {
  const { number, customerName, items, observations, cookId } = req.body;
  // number e items são obrigatórios; customerName pode ser vazio.
  if (!number || !Array.isArray(items)) {
    return res.status(400).json({ error: 'invalid_payload' });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const order = {
    tenantId: LEGACY_TENANT_ID,
    id,
    number,
    customerName: customerName || '',
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
    items: items.map(it => ({ id: crypto.randomUUID(), name: it.name, quantity: it.quantity || 1, notes: it.notes || '' }))
  };

  await Order.create(order);
  res.status(201).json(toISO(order));
  io.emit('orders:created', toISO(order));

  if (PRINT_PEDIDO_AUTO_ENABLED) {
    setImmediate(async () => {
      const printResult = await printPedido(
        order.number,
        PRINT_PEDIDO_IMPRESSORA,
        PRINT_PEDIDO_MODO,
        { outputDir: PRINT_PEDIDO_OUTPUT_DIR || undefined }
      );

      if (!printResult.ok) {
        console.warn(
          `[print-pedido] Falha no pedido ${order.number}: ${printResult.mensagem}`
          + (printResult.erroTecnico ? ` | detalhe: ${printResult.erroTecnico}` : '')
        );
        return;
      }

      console.log(
        `[print-pedido] Pedido ${order.number} impresso em modo ${PRINT_PEDIDO_MODO}`
        + (printResult.arquivoGerado ? ` | arquivo: ${printResult.arquivoGerado}` : '')
      );
    });
  }
}));

app.patch('/orders/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, cookId } = req.body;
  if (!status) return res.status(400).json({ error: 'missing_status' });
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' });

  const order = await Order.findOne({ tenantId: LEGACY_TENANT_ID, id }).lean();
  if (!order) return res.status(404).json({ error: 'not_found' });

  const authPermissions = req.authUser?.permissions || [];
  const actorCookId = authPermissions.includes('cook') ? req.authUser?.username : null;
  const resolvedCookId = actorCookId || (cookId ? String(cookId) : (order.cookId || null));

  const now = Date.now();
  const patch = { status, updatedAt: now };
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
  if (typeof number !== 'number' || !customerName || !Array.isArray(items)) {
    return res.status(400).json({ error: 'invalid_payload' });
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }

  const now = Date.now();
  const patch = {
    number,
    customerName,
    items: items.map(it => ({ id: it.id || crypto.randomUUID(), name: it.name, quantity: it.quantity || 1, notes: it.notes || '' })),
    observations: observations || '',
    status: status || existing.status,
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
