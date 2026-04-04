const Order = require('../models/Order');
const SyncEvent = require('../models/SyncEvent');

const MAX_RETRIES = 8;

async function applySyncEvent(event, io) {
  // Aplica evento de forma idempotente: updateOne com chaves tenantId+id.
  const now = Date.now();
  const payload = event.payload || {};

  if (event.eventType === 'order.created') {
    await Order.updateOne(
      { tenantId: event.tenantId, id: event.entityId },
      {
        $setOnInsert: {
          tenantId: event.tenantId,
          id: event.entityId,
          number: payload.number,
          customerName: payload.customerName || '',
          observations: payload.observations || '',
          createdAt: payload.createdAt || now,
          items: payload.items || [],
          status: payload.status || 'received',
        },
        $set: {
          updatedAt: now,
          syncVersion: payload.syncVersion || 1,
          lastSyncedAt: now,
        },
      },
      { upsert: true }
    );
  }

  if (event.eventType === 'order.updated.status') {
    await Order.updateOne(
      { tenantId: event.tenantId, id: event.entityId },
      {
        $set: {
          status: payload.status,
          updatedAt: now,
          syncVersion: Number(payload.syncVersion || 1),
          lastSyncedAt: now,
        },
      }
    );
  }

  const committedAt = new Date();
  await SyncEvent.updateOne(
    { _id: event._id },
    {
      $set: {
        status: 'processed',
        committedAt,
        lastError: null,
      },
    }
  );

  const updatedOrder = await Order.findOne({ tenantId: event.tenantId, id: event.entityId }).lean();
  if (updatedOrder) {
    // Evento unico para telas conectadas ao tenant receberem estado consolidado.
    io.to(`tenant:${event.tenantId}`).emit('orders:updated', updatedOrder);
  }
}

async function processBatch(io) {
  const now = new Date();
  const pending = await SyncEvent.find({
    status: { $in: ['pending', 'failed'] },
    nextRetryAt: { $lte: now },
    retries: { $lt: MAX_RETRIES },
  })
    .sort({ createdAt: 1 })
    .limit(100)
    .lean();

  for (const event of pending) {
    try {
      await applySyncEvent(event, io);
    } catch (error) {
      // Backoff exponencial limitado para evitar loop agressivo no banco.
      const retries = Number(event.retries || 0) + 1;
      const delayMs = Math.min(30000, Math.pow(2, retries) * 500);
      await SyncEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: 'failed',
            retries,
            lastError: String(error.message || error),
            nextRetryAt: new Date(Date.now() + delayMs),
          },
        }
      );
    }
  }
}

function startSyncWorker(io) {
  const intervalMs = Number(process.env.SAAS_SYNC_WORKER_INTERVAL_MS || 2000);
  const timer = setInterval(() => {
    // Loop enxuto: apenas agenda processamento e isola erro por ciclo.
    processBatch(io).catch(err => {
      console.error('sync worker failure', err);
    });
  }, intervalMs);

  return () => clearInterval(timer);
}

module.exports = {
  startSyncWorker,
};
