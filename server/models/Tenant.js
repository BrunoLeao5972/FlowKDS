const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    plan: { type: String, default: 'starter' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    collection: 'tenants',
  }
);

module.exports = mongoose.model('Tenant', tenantSchema);
