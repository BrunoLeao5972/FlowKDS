const Tenant = require('../models/Tenant');
const { verifyAccessToken } = require('./auth');

const LEGACY_TENANT_ID = process.env.LEGACY_TENANT_ID || 'legacy';

async function resolveTenant(req) {
  // Tenta extrair tenantId do JWT token (SaaS)
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      try {
        const claims = verifyAccessToken(token);
        if (claims.tenantId) {
          console.log('[Tenant] ✓ tenantId extraído do JWT:', claims.tenantId);
          // Para rotas do SaaS, armazenar o tenantId diretamente
          req.tenantIdFromJWT = claims.tenantId;
          return { _id: claims.tenantId, slug: 'jwt-tenant' }; // Retorna um tenant fake para satisfazer o middleware
        }
      } catch (err) {
        // Token inválido - pode ser token legado, continue silenciosamente
        console.debug('[Tenant] Bearer Token não é JWT válido (pode ser legado):', err.message.substring(0, 30));
      }
    }
  }

  // Tenta header x-tenant-id
  const headerTenant = String(req.headers['x-tenant-id'] || '').trim().toLowerCase();
  if (headerTenant) {
    try {
      const tenant = await Tenant.findOne({ slug: headerTenant, status: 'active' }).lean();
      return tenant || null;
    } catch (err) {
      console.debug('[Tenant] Erro ao buscar por header x-tenant-id:', err.message);
    }
  }

  // Tenta subdomain
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    console.log('[Tenant] ℹ Host é localhost/IP, usando LEGACY_TENANT_ID');
    // Retorna tenant legado para localhost
    return { _id: LEGACY_TENANT_ID, slug: 'legacy' };
  }

  const chunks = host.split('.');
  if (chunks.length >= 3 && chunks[0] !== 'www') {
    const subdomain = chunks[0];
    try {
      const tenant = await Tenant.findOne({ slug: subdomain, status: 'active' }).lean();
      if (tenant) {
        console.log('[Tenant] ✓ Tenant encontrado por subdomain:', subdomain);
        return tenant;
      }
    } catch (err) {
      console.debug('[Tenant] Erro ao buscar por subdomain:', err.message);
    }
  }

  // Fallback: usa LEGACY_TENANT_ID para usuários autenticados via sistema legado
  console.log('[Tenant] ℹ Nenhum método funcionou, usando LEGACY_TENANT_ID');
  return { _id: LEGACY_TENANT_ID, slug: 'legacy' };
}

async function tenantMiddleware(req, res, next) {
  const tenant = await resolveTenant(req);
  if (!tenant) {
    // Se não conseguir resolver tenant, não retorna erro aqui
    // Deixa as rotas individuais (como themeRoutes) se encarregarem da autenticação
    console.log('[Tenant] Não conseguiu resolver tenant para:', req.path);
    // Continua mesmo sem tenant para permitir fallbacks nas rotas específicas
    return next();
  }
  req.tenant = tenant;
  return next();
}

module.exports = {
  resolveTenant,
  tenantMiddleware,
  LEGACY_TENANT_ID
};
