const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const User = require('../models/User');
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const SyncEvent = require('../models/SyncEvent');
const RefreshToken = require('../models/RefreshToken');
const themeRoutes = require('./themeRoutes');

const {
  issueAccessToken,
  issueRefreshToken,
  hashRefreshToken,
  getRefreshExpiryDate,
  verifyAccessToken,
} = require('./auth');
const { tenantMiddleware } = require('./tenant');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parseBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

function createSaasRouter(io) {
  const router = express.Router();

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post('/tenants', authLimiter, asyncHandler(async (req, res) => {
    const { companyName, slug, adminUsername, adminPassword } = req.body || {};
    if (!companyName || !slug || !adminUsername || !adminPassword) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    const tenantSlug = String(slug).trim().toLowerCase();
    const exists = await Tenant.findOne({ slug: tenantSlug }).lean();
    if (exists) return res.status(409).json({ error: 'tenant_slug_already_exists' });

    const tenant = await Tenant.create({ name: companyName, slug: tenantSlug, plan: 'starter' });

    const user = new User({
      tenantId: String(tenant._id),
      username: String(adminUsername).trim().toLowerCase(),
      passwordHash: adminPassword,
      permissions: ['admin', 'kitchen', 'display', 'settings'],
    });
    await user.save();

    return res.status(201).json({
      tenantId: String(tenant._id),
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      adminUserId: String(user._id),
    });
  }));

  router.post('/auth/login', authLimiter, tenantMiddleware, asyncHandler(async (req, res) => {
    const { username, password, deviceId } = req.body || {};
    const normalized = String(username || '').trim().toLowerCase();

    const user = await User.findOne({ tenantId: String(req.tenant._id), username: normalized });
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const identity = {
      id: String(user._id),
      tenantId: String(req.tenant._id),
      username: user.username,
      permissions: user.permissions,
    };

    const accessToken = issueAccessToken(identity);
    const refreshToken = issueRefreshToken();
    await RefreshToken.create({
      tenantId: identity.tenantId,
      userId: identity.id,
      tokenHash: hashRefreshToken(refreshToken),
      deviceId: deviceId || null,
      ip: String(req.ip || ''),
      userAgent: String(req.headers['user-agent'] || ''),
      expiresAt: getRefreshExpiryDate(),
    });

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: identity.id,
        username: identity.username,
        permissions: identity.permissions,
      },
      tenant: {
        id: identity.tenantId,
        slug: req.tenant.slug,
        name: req.tenant.name,
      },
    });
  }));

  router.post('/auth/refresh', authLimiter, tenantMiddleware, asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: 'refresh_token_required' });

    const tokenHash = hashRefreshToken(refreshToken);
    const record = await RefreshToken.findOne({
      tenantId: String(req.tenant._id),
      tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!record) return res.status(401).json({ error: 'invalid_refresh_token' });

    const user = await User.findOne({ _id: record.userId, tenantId: String(req.tenant._id) }).lean();
    if (!user) return res.status(401).json({ error: 'user_not_found' });

    const accessToken = issueAccessToken({
      id: String(user._id),
      tenantId: String(req.tenant._id),
      username: user.username,
      permissions: user.permissions,
    });

    return res.json({ accessToken });
  }));

  router.use(tenantMiddleware);
  
  // ⭐ TEMAS: Registra ANTES da middleware de autenticação global
  // porque temas são independentes de JWT (resolvem próprio tenantId)
  router.use('/themes', themeRoutes);

  router.use(asyncHandler(async (req, res, next) => {
    const token = parseBearerToken(req);
    if (!token) return res.status(401).json({ error: 'missing_bearer_token' });

    try {
      const claims = verifyAccessToken(token);
      if (String(claims.tenantId) !== String(req.tenant._id)) {
        return res.status(403).json({ error: 'invalid_tenant_claim' });
      }
      req.auth = claims;
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_or_expired_token' });
    }
  }));

  router.get('/orders', asyncHandler(async (req, res) => {
    const since = Number(req.query.since || 0);
    const query = {
      tenantId: String(req.tenant._id),
    };

    if (since > 0) {
      query.updatedAt = { $gt: since };
    }

    const orders = await Order.find(query).sort({ createdAt: 1 }).lean();
    return res.json(orders);
  }));

  router.post('/sync/push', asyncHandler(async (req, res) => {
    const { deviceId, events } = req.body || {};
    if (!Array.isArray(events) || !events.length) {
      return res.status(400).json({ error: 'events_required' });
    }

    const accepted = [];
    for (const event of events) {
      const clientMutationId = String(event.clientMutationId || crypto.randomUUID());
      try {
        const saved = await SyncEvent.create({
          tenantId: String(req.tenant._id),
          source: 'device',
          deviceId: deviceId || null,
          eventType: event.eventType,
          entityId: event.entityId,
          payload: event.payload || {},
          clientMutationId,
          status: 'pending',
          nextRetryAt: new Date(),
        });
        accepted.push({
          eventId: String(saved._id),
          clientMutationId,
          status: saved.status,
        });
      } catch (error) {
        if (error && error.code === 11000) {
          accepted.push({ clientMutationId, status: 'duplicate' });
          continue;
        }
        accepted.push({ clientMutationId, status: 'rejected' });
      }
    }

    return res.status(202).json({ accepted });
  }));

  router.get('/sync/pull', asyncHandler(async (req, res) => {
    const sinceRaw = req.query.since;
    const since = sinceRaw ? new Date(Number(sinceRaw)) : new Date(0);

    const events = await SyncEvent.find({
      tenantId: String(req.tenant._id),
      status: 'processed',
      source: 'device',
      committedAt: { $gt: since },
    })
      .sort({ committedAt: 1 })
      .limit(500)
      .lean();

    return res.json({
      serverTime: Date.now(),
      events,
    });
  }));

  router.post('/orders', asyncHandler(async (req, res) => {
    const now = Date.now();
    const orderPayload = req.body || {};
    const id = String(orderPayload.id || crypto.randomUUID());
    const order = await Order.create({
      tenantId: String(req.tenant._id),
      id,
      number: orderPayload.number,
      customerName: orderPayload.customerName || '',
      observations: orderPayload.observations || '',
      items: orderPayload.items || [],
      status: orderPayload.status || 'received',
      createdAt: now,
      updatedAt: now,
      syncVersion: 1,
      lastSyncedAt: now,
    });

    await SyncEvent.create({
      tenantId: String(req.tenant._id),
      source: 'cloud',
      eventType: 'order.created',
      entityId: id,
      payload: order.toObject(),
      status: 'processed',
      committedAt: new Date(),
      nextRetryAt: new Date(),
    });

    io.to(`tenant:${String(req.tenant._id)}`).emit('orders:created', order.toObject());

    return res.status(201).json(order);
  }));

  router.patch('/orders/:id/status', asyncHandler(async (req, res) => {
    const status = String(req.body.status || '');
    const allowed = ['received', 'preparing', 'ready', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid_status' });

    const order = await Order.findOneAndUpdate(
      { tenantId: String(req.tenant._id), id: req.params.id },
      {
        $set: {
          status,
          updatedAt: Date.now(),
        },
        $inc: { syncVersion: 1 },
      },
      { new: true }
    );

    if (!order) return res.status(404).json({ error: 'order_not_found' });

    await SyncEvent.create({
      tenantId: String(req.tenant._id),
      source: 'cloud',
      eventType: 'order.updated.status',
      entityId: req.params.id,
      payload: { status, syncVersion: order.syncVersion },
      status: 'processed',
      committedAt: new Date(),
      nextRetryAt: new Date(),
    });

    io.to(`tenant:${String(req.tenant._id)}`).emit('orders:updated', order.toObject());

    return res.json(order);
  }));

  return router;
}

module.exports = {
  createSaasRouter,
};
