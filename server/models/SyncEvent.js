const mongoose = require('mongoose');

const syncEventSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    source: { type: String, enum: ['device', 'cloud'], required: true, index: true },
    deviceId: { type: String, default: null, index: true },
    eventType: { type: String, enum: ['order.created', 'order.updated.status'], required: true },
    entityId: { type: String, required: true, index: true },
    payload: { type: Object, required: true },
    clientMutationId: { type: String, default: null },
    status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending', index: true },
    retries: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: Date.now, index: true },
    lastError: { type: String, default: null },
    committedAt: { type: Date, default: null, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  {
    versionKey: false,
    collection: 'sync_events',
  }
);

syncEventSchema.index({ tenantId: 1, clientMutationId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('SyncEvent', syncEventSchema);
