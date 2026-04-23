export type OrderStatus = 'received' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
export type ItemStatus = 'waiting' | 'preparing' | 'ready';
export type ServiceMode = 'balcao' | 'mesa' | 'cartao' | 'delivery' | 'encomenda' | 'servico' | 'apartamento';

export interface Sector {
  id: string;
  name: string;
  sortOrder: number;
  isActive?: boolean;
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
  externalId?: string | null;
  demandId?: string | null;
  number: number;
  customerName: string;
  serviceMode?: ServiceMode | null;
  cookId?: string | null;
  attendant?: string | null;
  integratorId?: string | null;
  integratorName?: string | null;
  sellerName?: string | null;
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
