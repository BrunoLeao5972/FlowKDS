const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_TOKEN_TTL = process.env.SAAS_ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.SAAS_REFRESH_TOKEN_TTL_DAYS || 14);
const JWT_SECRET = process.env.SAAS_JWT_SECRET || process.env.AUTH_TOKEN_SECRET || 'replace-me';

function issueAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      tenantId: user.tenantId,
      username: user.username,
      permissions: user.permissions || [],
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function issueRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getRefreshExpiryDate() {
  const dt = new Date();
  dt.setDate(dt.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return dt;
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  issueAccessToken,
  issueRefreshToken,
  hashRefreshToken,
  getRefreshExpiryDate,
  verifyAccessToken,
};
