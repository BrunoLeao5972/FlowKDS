const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, default: 'legacy', index: true },
    id: { type: String, required: true, index: true },
    number: { type: Number, required: true },
    customerName: { type: String, default: '' },
    observations: { type: String, default: '' },
    status: {
      type: String,
      enum: ['received', 'preparing', 'ready', 'delivered', 'cancelled'],
      default: 'received',
      index: true,
    },
    createdAt: { type: Number, required: true, index: true },
    updatedAt: { type: Number, required: true },
    acceptedAt: { type: Number, default: null },
    startedAt: { type: Number, default: null },
    finishedAt: { type: Number, default: null },
    prepareStartedAt: { type: Number, default: null },
    readyAt: { type: Number, default: null },
    deliveredAt: { type: Number, default: null },
    cancelledAt: { type: Number, default: null },
    cancelAcknowledgedAt: { type: Number, default: null },
    cookId: { type: String, default: null, index: true },
    startedAtHistory: { type: [Number], default: [] },
    stageEvents: {
      type: [
        {
          _id: false,
          status: { type: String, enum: ['received', 'preparing', 'ready', 'delivered', 'cancelled'], required: true },
          at: { type: Number, required: true },
          cookId: { type: String, default: null },
        },
      ],
      default: [],
    },
    syncVersion: { type: Number, default: 1, index: true },
    lastSyncedAt: { type: Number, default: null },
    items: { type: [orderItemSchema], default: [] },
  },
  {
    versionKey: false,
    collection: 'orders',
  }
);

orderSchema.index({ tenantId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Order', orderSchema);
