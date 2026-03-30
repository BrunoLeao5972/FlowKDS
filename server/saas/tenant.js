const Tenant = require('../models/Tenant');

async function resolveTenant(req) {
  const headerTenant = String(req.headers['x-tenant-id'] || '').trim().toLowerCase();
  if (headerTenant) {
    const tenant = await Tenant.findOne({ slug: headerTenant, status: 'active' }).lean();
    return tenant || null;
  }

  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  const chunks = host.split('.');
  if (chunks.length < 3) return null;
  const subdomain = chunks[0];
  const tenant = await Tenant.findOne({ slug: subdomain, status: 'active' }).lean();
  return tenant || null;
}

async function tenantMiddleware(req, res, next) {
  const tenant = await resolveTenant(req);
  if (!tenant) {
    return res.status(400).json({ error: 'tenant_not_resolved', message: 'Use x-tenant-id header or tenant subdomain.' });
  }
  req.tenant = tenant;
  return next();
}

module.exports = {
  resolveTenant,
  tenantMiddleware,
};
