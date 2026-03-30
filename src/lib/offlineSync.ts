import { Order, OrderStatus } from '@/types/order';

type SyncEventType = 'order.created' | 'order.updated.status';

export interface OfflineSyncEvent {
  clientMutationId: string;
  eventType: SyncEventType;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

type StoreName = 'orders' | 'outbox' | 'meta';

const DB_NAME = 'kds-offline-sync';
const DB_VERSION = 1;

function randomId() {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('orders')) {
        db.createObjectStore('orders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'clientMutationId' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(storeName: StoreName, mode: IDBTransactionMode, action: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = await action(store);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheOrders(orders: Order[]): Promise<void> {
  await withStore('orders', 'readwrite', async store => {
    for (const order of orders) {
      store.put({ id: order.id, order, updatedAt: Date.now() });
    }
  });
}

export async function getCachedOrders(): Promise<Order[]> {
  return withStore('orders', 'readonly', async store => {
    const values = await requestToPromise(store.getAll() as IDBRequest<Array<{ id: string; order: Order }>>);
    return values.map(v => v.order).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  });
}

export async function enqueueStatusUpdate(orderId: string, status: OrderStatus, syncVersion: number): Promise<OfflineSyncEvent> {
  const event: OfflineSyncEvent = {
    clientMutationId: randomId(),
    eventType: 'order.updated.status',
    entityId: orderId,
    payload: {
      status,
      syncVersion,
    },
    createdAt: Date.now(),
  };

  await withStore('outbox', 'readwrite', async store => {
    store.put(event);
  });

  return event;
}

export async function getOutboxEvents(): Promise<OfflineSyncEvent[]> {
  return withStore('outbox', 'readonly', async store => {
    const events = await requestToPromise(store.getAll() as IDBRequest<OfflineSyncEvent[]>);
    return events.sort((a, b) => a.createdAt - b.createdAt);
  });
}

export async function removeOutboxEvents(clientMutationIds: string[]): Promise<void> {
  await withStore('outbox', 'readwrite', async store => {
    for (const id of clientMutationIds) {
      store.delete(id);
    }
  });
}

export async function getLastPullTimestamp(): Promise<number> {
  return withStore('meta', 'readonly', async store => {
    const record = await requestToPromise(store.get('lastPullAt') as IDBRequest<{ key: string; value: string } | undefined>);
    return record ? Number(record.value) : 0;
  });
}

export async function setLastPullTimestamp(ts: number): Promise<void> {
  await withStore('meta', 'readwrite', async store => {
    store.put({ key: 'lastPullAt', value: String(ts) });
  });
}

interface PushResult {
  accepted: Array<{ clientMutationId: string; status: string }>;
}

export async function flushOutbox(params: {
  apiBase: string;
  tenantId: string;
  accessToken: string;
  deviceId: string;
}): Promise<PushResult> {
  const events = await getOutboxEvents();
  if (!events.length) return { accepted: [] };

  const response = await fetch(`${params.apiBase}/saas/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
      'x-tenant-id': params.tenantId,
    },
    body: JSON.stringify({
      deviceId: params.deviceId,
      events,
    }),
  });

  if (!response.ok) {
    throw new Error(`sync_push_failed:${response.status}`);
  }

  const body: PushResult = await response.json();
  const delivered = body.accepted
    .filter(item => item.status === 'pending' || item.status === 'duplicate')
    .map(item => item.clientMutationId);

  if (delivered.length) {
    await removeOutboxEvents(delivered);
  }

  return body;
}

export async function pullCommittedEvents(params: {
  apiBase: string;
  tenantId: string;
  accessToken: string;
}): Promise<Array<{ eventType: string; entityId: string; payload: Record<string, unknown> }>> {
  const since = await getLastPullTimestamp();

  const response = await fetch(`${params.apiBase}/saas/sync/pull?since=${since}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'x-tenant-id': params.tenantId,
    },
  });

  if (!response.ok) {
    throw new Error(`sync_pull_failed:${response.status}`);
  }

  const payload = await response.json() as {
    serverTime: number;
    events: Array<{ eventType: string; entityId: string; payload: Record<string, unknown> }>;
  };

  await setLastPullTimestamp(payload.serverTime || Date.now());
  return payload.events;
}
