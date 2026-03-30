export type OrderStatus = 'received' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  notes?: string;
}

export interface Order {
  id: string;
  number: number;
  customerName: string;
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
