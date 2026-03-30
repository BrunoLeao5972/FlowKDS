const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    deviceId: { type: String, default: null, index: true },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    collection: 'refresh_tokens',
  }
);

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
