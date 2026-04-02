export type OrderStatus = 'received' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
export type ItemStatus = 'waiting' | 'preparing' | 'ready';

export interface Sector {
  id: string;
  name: string;
  sortOrder: number;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  notes?: string;
  sectorId?: string | null;
  itemStatus?: ItemStatus;
}

export interface Order {
  id: string;
  number: number;
  customerName: string;
  cookId?: string | null;
  items: OrderItem[];
  observations: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  prepareStartedAt?: Date;
  readyAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancelAcknowledgedAt?: Date;
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  received: 'Recebido',
  preparing: 'Em Preparo',
  ready: 'Pronto',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};
