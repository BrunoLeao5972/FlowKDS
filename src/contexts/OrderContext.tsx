import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Order, OrderStatus, Sector, ItemStatus, ServiceMode } from '@/types/order';
import { useSettings } from './SettingsContext';
import { useAuth } from './AuthContext';
import { getDisplayCustomerName, getPrintableTicketIdentity } from '@/lib/customerName';

interface OrderContextType {
  orders: Order[];
  sectors: Sector[];
  addOrder: (order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateStatus: (id: string, status: OrderStatus, cookId?: string) => void;
  updateItemStatus: (orderId: string, itemId: string, itemStatus: ItemStatus, itemIndex?: number) => void;
  cancelOrder: (id: string) => void;
  acknowledgeCancelledOrder: (id: string) => void;
  getOrdersByStatus: (status: OrderStatus) => Order[];
  getAveragePrepTime: () => number;
  printOrderTicket: (order: Order) => Promise<void>;
  reprintOrderTicket: (order: Order) => Promise<void>;
}

const OrderContext = createContext<OrderContextType | null>(null);

const INITIAL_ORDERS: Order[] = [];
const ALL_SERVICE_MODES: ServiceMode[] = ['balcao', 'mesa', 'cartao', 'delivery', 'encomenda', 'servico', 'apartamento'];

// Normaliza aliases e variações de acentuação para garantir filtro consistente
// entre payloads vindos de APIs diferentes (serviceMode/modality/tipoAtendimento).
const normalizeServiceMode = (value: unknown): ServiceMode | null => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const aliases: Record<string, ServiceMode> = {
    balcao: 'balcao',
    balcon: 'balcao',
    mesa: 'mesa',
    cartao: 'cartao',
    delivery: 'delivery',
    entrega: 'delivery',
    encomenda: 'encomenda',
    servico: 'servico',
    apartamento: 'apartamento',
    // Compatibilidade com códigos numéricos da integração SQL
    '1': 'balcao',
    '16': 'balcao',
    '2': 'mesa',
    '17': 'mesa',
    '3': 'cartao',
    '4': 'delivery',
    '5': 'encomenda',
  };

  return aliases[normalized] || null;
};

const getOrderIdentityKey = (order: Partial<Order> & { id?: string | null; externalId?: string | null; demandId?: string | null }) => {
  const demandId = String((order as any).demandId || '').trim();
  if (demandId) return `demand:${demandId}`;

  const externalId = String(order.externalId || '').trim();
  if (externalId.includes('::')) {
    const baseExternalId = externalId.split('::')[0].trim();
    if (baseExternalId) return `legacy-external:${baseExternalId}`;
  }

  const id = String(order.id || '').trim();
  if (id) return `id:${id}`;
  if (externalId) return `external:${externalId}`;
  const number = Number(order.number || 0);
  const createdAt = order.createdAt instanceof Date ? order.createdAt.toISOString() : String(order.createdAt || '');
  return `fallback:${number}:${createdAt}`;
};

const sortOrdersByCreatedAt = (orders: Order[]) => [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

const dedupeOrders = (orders: Order[]) => {
  const byIdentity = new Map<string, Order>();

  for (const order of orders) {
    const key = getOrderIdentityKey(order);
    const previous = byIdentity.get(key);
    if (!previous || order.updatedAt.getTime() >= previous.updatedAt.getTime()) {
      byIdentity.set(key, order);
    }
  }

  return sortOrdersByCreatedAt([...byIdentity.values()]);
};

const getTicketDisplayNumber = (order: Pick<Order, 'number' | 'serviceMode' | 'lancamentoId'>): number => {
  const mode = normalizeServiceMode(order.serviceMode);
  if (mode === 'balcao' || mode === 'delivery' || mode === 'encomenda') {
    const digits = String(order.lancamentoId || '').replace(/\D/g, '');
    if (digits.length >= 3) {
      const pickupNumber = Number(digits.slice(-3));
      if (Number.isFinite(pickupNumber) && pickupNumber > 0) {
        return pickupNumber;
      }
    }
  }

  return Number(order.number || 0);
};

const replaceOrderByIdentity = (orders: Order[], nextOrder: Order) => {
  const key = getOrderIdentityKey(nextOrder);
  return sortOrdersByCreatedAt([
    ...orders.filter(order => getOrderIdentityKey(order) !== key),
    nextOrder,
  ]);
};

// Pedidos de mesa, cartão e apartamento não geram ticket automático de balcão/cozinha.
const shouldAutoPrintTicket = (order: Pick<Order, 'serviceMode'>): boolean => {
  const mode = normalizeServiceMode(order.serviceMode);
  return mode !== 'mesa' && mode !== 'cartao' && mode !== 'apartamento';
};

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const settings = useSettings();
  const { token, isAuthenticated, logout } = useAuth();

  // Ref para rastrear pedidos que chegaram com status 'received' e precisam de autoPrep
  const autoPrepQueueRef = useRef<Set<string>>(new Set());

  // Em produção, frontend e API usam o mesmo domínio.
  // Em desenvolvimento local, a API roda na 8081.
  const API_BASE = import.meta.env.VITE_API_BASE || (window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:8081`
    : window.location.origin);

  const authHeaders = useMemo(() => (token ? { 'x-kds-token': token } : {}), [token]);
  const normalizedEnabledServiceModes = useMemo(
    () => (settings.enabledServiceModes || []).map(mode => normalizeServiceMode(mode)).filter((mode): mode is ServiceMode => !!mode),
    [settings.enabledServiceModes]
  );

  // Se não houver filtro configurado, todos os modos ficam habilitados por padrão.
  const isOrderAllowedByServiceMode = useCallback((order: Order) => {
    const orderServiceMode = normalizeServiceMode(order.serviceMode);
    if (!orderServiceMode) return true;

    const effectiveModes = normalizedEnabledServiceModes.length
      ? normalizedEnabledServiceModes
      : ALL_SERVICE_MODES;

    return effectiveModes.includes(orderServiceMode);
  }, [normalizedEnabledServiceModes]);

  // Aceita prefixos no formato MODO:DESTINO para manter compatibilidade com setups
  // antigos e novos (IMPRESSORA, HTML e FILE).
  const resolvePrinterMode = useCallback((rawPrinterName: string) => {
    const input = String(rawPrinterName || '').trim();
    const upper = input.toUpperCase();

    if (upper.startsWith('IMPRESSORA:')) {
      return {
        mode: 'IMPRESSORA' as const,
        printerName: input.slice('IMPRESSORA:'.length).trim(),
      };
    }

    if (upper.startsWith('HTML:')) {
      return {
        mode: 'HTML' as const,
        printerName: input.slice(5).trim(),
      };
    }

    if (upper.startsWith('FILE:')) {
      return {
        mode: 'FILE' as const,
        printerName: input.slice(5).trim(),
      };
    }

    if (input) {
      return {
        mode: 'IMPRESSORA' as const,
        printerName: input,
      };
    }

    return {
      mode: 'HTML' as const,
      printerName: '',
    };
  }, []);

  // Gera HTML local para modo de teste/diagnóstico sem depender do spooler.
  const buildTicketHtml = useCallback((order: Order, resolvedPrinterName: string) => {
    const createdAt = new Date(order.createdAt);
    const dateText = createdAt.toLocaleString('pt-BR');
    const displayNumber = getTicketDisplayNumber(order);
    const printableIdentity = getPrintableTicketIdentity({
      customerName: order.customerName,
      serviceMode: order.serviceMode,
      attendant: order.attendant,
      sellerName: order.sellerName,
    });
    const ticketWidth = settings.printSize === '58mm' ? 220 : settings.printSize === '80mm' ? 300 : 420;
    const tradeName = settings.restaurantTradeName ? String(settings.restaurantTradeName).trim() : '';
    return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Senha ${displayNumber}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 16px; }
      .ticket { width: ${ticketWidth}px; border: 1px dashed #999; padding: 12px; }
      .trade-name { text-align: center; font-weight: 700; font-size: 16px; margin-bottom: 4px; color: #222; }
      .title { text-align: center; font-size: 12px; color: #222; margin-bottom: 10px; }
      .senha { text-align: center; font-size: 48px; font-weight: 700; margin: 8px 0; }
      .line { margin: 6px 0; font-size: 14px; }
      .items { margin-top: 10px; border-top: 1px dashed #bbb; padding-top: 8px; }
      .footer { margin-top: 12px; border-top: 1px dashed #bbb; padding-top: 8px; text-align: center; font-size: 12px; color: #222; }
      .hint { margin-top: 10px; font-size: 12px; color: #666; }
      @media print {
        body { padding: 0; margin: 0; }
        .ticket { border: none; width: auto; padding: 8px 12px 20px 12px; }
        .footer { padding-bottom: 12px; page-break-inside: avoid; }
        .hint { display: none; }
      }
    </style>
  </head>
  <body>
    <div class="ticket">
      ${tradeName ? `<div class="trade-name">${tradeName}</div>` : ''}
      <div class="title">SENHA DO PEDIDO</div>
      <div class="senha">${displayNumber}</div>
      <div class="line"><strong>${printableIdentity.label}:</strong> ${printableIdentity.name}</div>
      <div class="line"><strong>Data/Hora:</strong> ${dateText}</div>
      <div class="items">
        ${order.items.map(item => `<div class="line">${item.quantity}x ${item.name}</div>`).join('') || '<div class="line">Sem itens</div>'}
      </div>
      <div class="footer">solucaosistemas.net</div>
      <div class="hint">Modo HTML para visualizacao/teste.</div>
    </div>
  </body>
</html>`;
  }, [settings.printSize, settings.restaurantTradeName]);

  const printOrderTicket = useCallback(async (createdOrder: Order) => {
    if (!shouldAutoPrintTicket(createdOrder)) return;

    const resolved = resolvePrinterMode(settings.printerName || '');
    const mode = resolved.mode;
    if (mode === 'HTML') {
      const popup = window.open('', '_blank', 'noopener,noreferrer,width=420,height=700');
      if (popup) {
        popup.document.open();
        popup.document.write(buildTicketHtml(createdOrder, resolved.printerName));
        popup.document.close();
        return;
      }

      // Fallback: se popup estiver bloqueado, delega a geração para o backend.
      try {
        await fetch(`${API_BASE}/print/ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            mode: 'HTML',
            printerName: resolved.printerName,
            printSize: settings.printSize,
            printScale: settings.printScale,
            orderNumber: createdOrder.number,
            lancamentoId: (createdOrder as any).lancamentoId || null,
            externalId: (createdOrder as any).externalId || null,
            launchCode: (createdOrder as any).launchCode || null,
            customerName: createdOrder.customerName,
            serviceMode: createdOrder.serviceMode,
            attendant: createdOrder.attendant,
            sellerName: createdOrder.sellerName,
            tradeName: settings.restaurantTradeName || '',
            items: createdOrder.items,
          }),
        });
      } catch (error) {
        console.error('Falha ao enviar impressão HTML', error);
      }
      return;
    }

    try {
      await fetch(`${API_BASE}/print/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          mode,
          printerName: resolved.printerName,
          printSize: settings.printSize,
          printScale: settings.printScale,
          orderNumber: createdOrder.number,
          lancamentoId: (createdOrder as any).lancamentoId || null,
          externalId: (createdOrder as any).externalId || null,
          launchCode: (createdOrder as any).launchCode || null,
          customerName: createdOrder.customerName,
          serviceMode: createdOrder.serviceMode,
          attendant: createdOrder.attendant,
          sellerName: createdOrder.sellerName,
          tradeName: settings.restaurantTradeName || '',
          items: createdOrder.items,
        }),
      });
    } catch (error) {
      console.error(`Falha ao enviar impressão ${mode}`, error);
    }
  }, [API_BASE, authHeaders, buildTicketHtml, resolvePrinterMode, settings.printerName, settings.printScale, settings.printSize, settings.restaurantTradeName]);

  const reprintOrderTicket = useCallback(async (order: Order) => {
    const resolved = resolvePrinterMode(settings.printerName || '');

    let orderToPrint: Order = order;
    try {
      const latestOrderResp = await fetch(`${API_BASE}/orders/${order.id}`, { headers: authHeaders });
      if (latestOrderResp.status === 401) {
        logout();
        return;
      }
      if (latestOrderResp.ok) {
        const latestOrder: Order = await latestOrderResp.json();
        orderToPrint = {
          ...latestOrder,
          externalId: (latestOrder as any).externalId || null,
          customerName: getDisplayCustomerName(latestOrder.customerName),
          serviceMode: normalizeServiceMode((latestOrder as any).serviceMode ?? (latestOrder as any).modality ?? (latestOrder as any).tipoAtendimento),
          cookId: latestOrder.cookId || null,
          createdAt: new Date(latestOrder.createdAt),
          updatedAt: new Date(latestOrder.updatedAt),
          acceptedAt: latestOrder.acceptedAt ? new Date(latestOrder.acceptedAt) : undefined,
          startedAt: latestOrder.startedAt ? new Date(latestOrder.startedAt) : undefined,
          finishedAt: latestOrder.finishedAt ? new Date(latestOrder.finishedAt) : undefined,
          prepareStartedAt: latestOrder.prepareStartedAt ? new Date(latestOrder.prepareStartedAt) : undefined,
          readyAt: latestOrder.readyAt ? new Date(latestOrder.readyAt) : undefined,
          deliveredAt: latestOrder.deliveredAt ? new Date(latestOrder.deliveredAt) : undefined,
          cancelledAt: latestOrder.cancelledAt ? new Date(latestOrder.cancelledAt) : undefined,
          cancelAcknowledgedAt: latestOrder.cancelAcknowledgedAt ? new Date(latestOrder.cancelAcknowledgedAt) : undefined,
        } as Order;
      }

      await fetch(`${API_BASE}/print/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          mode: resolved.mode,
          printerName: resolved.printerName,
          printSize: settings.printSize,
          printScale: settings.printScale,
          orderNumber: orderToPrint.number,
          lancamentoId: (orderToPrint as any).lancamentoId || null,
          externalId: (orderToPrint as any).externalId || null,
          launchCode: (orderToPrint as any).launchCode || null,
          customerName: orderToPrint.customerName,
          serviceMode: orderToPrint.serviceMode,
          attendant: orderToPrint.attendant,
          sellerName: orderToPrint.sellerName,
          tradeName: settings.restaurantTradeName || '',
          items: orderToPrint.items,
        }),
      });
    } catch (error) {
      console.error('Falha ao reimprimir ticket', error);
    }
  }, [API_BASE, authHeaders, resolvePrinterMode, settings.printerName, settings.printScale, settings.printSize, settings.restaurantTradeName]);

  const addOrder = useCallback(async (order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const resp = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(order),
      });
      if (resp.status === 401) {
        logout();
        return;
      }
      if (!resp.ok) throw new Error('failed to create');
      const created: Order = await resp.json();
      // Uniformiza payload recebido antes de qualquer uso local (UI/impressão).
      const normalized = {
        ...created,
        customerName: getDisplayCustomerName(created.customerName),
        serviceMode: normalizeServiceMode((created as any).serviceMode ?? (created as any).modality ?? (created as any).tipoAtendimento),
        cookId: created.cookId || null,
        createdAt: new Date(created.createdAt),
        updatedAt: new Date(created.updatedAt),
        acceptedAt: created.acceptedAt ? new Date(created.acceptedAt) : undefined,
        startedAt: created.startedAt ? new Date(created.startedAt) : undefined,
        finishedAt: created.finishedAt ? new Date(created.finishedAt) : undefined,
        prepareStartedAt: created.prepareStartedAt ? new Date(created.prepareStartedAt) : undefined,
        readyAt: created.readyAt ? new Date(created.readyAt) : undefined,
        deliveredAt: created.deliveredAt ? new Date(created.deliveredAt) : undefined,
        cancelledAt: created.cancelledAt ? new Date(created.cancelledAt) : undefined,
        cancelAcknowledgedAt: created.cancelAcknowledgedAt ? new Date(created.cancelAcknowledgedAt) : undefined,
      } as Order;
      void printOrderTicket(normalized);
      // Evita duplicidade: a inclusão local acontece apenas via evento do socket.
      return normalized;
    } catch (err) {
      console.error('addOrder failed', err);
    }
  }, [API_BASE, authHeaders, logout, printOrderTicket]);

  const updateStatus = useCallback((id: string, status: OrderStatus, cookId?: string) => {
    // Optimistic update: atualiza UI imediatamente para reduzir latência percebida.
    const now = new Date();
    const previousOrders = orders;
    
    setOrders(prev => prev.map(o => {
      if (o.id !== id) return o;
      return {
        ...o,
        status,
        updatedAt: now,
        acceptedAt: o.acceptedAt || (status === 'preparing' ? now : o.acceptedAt),
        startedAt: o.startedAt || (status === 'preparing' ? now : o.startedAt),
        prepareStartedAt: status === 'preparing' && !o.prepareStartedAt ? now : o.prepareStartedAt,
        readyAt: status === 'ready' && !o.readyAt ? now : o.readyAt,
        deliveredAt: status === 'delivered' && !o.deliveredAt ? now : o.deliveredAt,
        cookId: status === 'preparing' ? (cookId || o.cookId || null) : o.cookId,
      };
    }));

    // Sincroniza com servidor em background; em erro, reverte snapshot local.
    fetch(`${API_BASE}/orders/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ status, ...(cookId ? { cookId } : {}) }),
    })
      .then(resp => {
        if (resp.status === 401) {
          logout();
          return null;
        }
        if (!resp.ok) throw new Error('failed to update');
        return resp.json();
      })
      .then(updated => {
        if (!updated) return; // Caso 401
        const normalized = {
          ...updated,
          cookId: updated.cookId || null,
          createdAt: new Date(updated.createdAt),
          updatedAt: new Date(updated.updatedAt),
          acceptedAt: updated.acceptedAt ? new Date(updated.acceptedAt) : undefined,
          startedAt: updated.startedAt ? new Date(updated.startedAt) : undefined,
          finishedAt: updated.finishedAt ? new Date(updated.finishedAt) : undefined,
          prepareStartedAt: updated.prepareStartedAt ? new Date(updated.prepareStartedAt) : undefined,
          readyAt: updated.readyAt ? new Date(updated.readyAt) : undefined,
          deliveredAt: updated.deliveredAt ? new Date(updated.deliveredAt) : undefined,
          cancelledAt: updated.cancelledAt ? new Date(updated.cancelledAt) : undefined,
          cancelAcknowledgedAt: updated.cancelAcknowledgedAt ? new Date(updated.cancelAcknowledgedAt) : undefined,
        } as Order;
        setOrders(prev => prev.map(o => (o.id === id ? normalized : o)));
      })
      .catch(err => {
        console.error('updateStatus failed', err);
        // Revert ao estado anterior em caso de erro
        setOrders(previousOrders);
      });
  }, [API_BASE, authHeaders, logout, orders]);

  const cancelOrder = useCallback((id: string) => {
    updateStatus(id, 'cancelled');
  }, [updateStatus]);

  const acknowledgeCancelledOrder = useCallback(async (id: string) => {
    const acknowledgedAt = new Date();
    setOrders(prev => prev.map(o => (o.id === id ? { ...o, cancelAcknowledgedAt: acknowledgedAt } : o)));

    try {
      const resp = await fetch(`${API_BASE}/orders/${id}/cancel-ack`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
      });
      if (resp.status === 401) {
        logout();
        return;
      }
      if (!resp.ok) throw new Error('failed to acknowledge cancelled order');
      const updated: Order = await resp.json();
      const normalized = {
        ...updated,
        cookId: updated.cookId || null,
        createdAt: new Date(updated.createdAt),
        updatedAt: new Date(updated.updatedAt),
        acceptedAt: updated.acceptedAt ? new Date(updated.acceptedAt) : undefined,
        startedAt: updated.startedAt ? new Date(updated.startedAt) : undefined,
        finishedAt: updated.finishedAt ? new Date(updated.finishedAt) : undefined,
        prepareStartedAt: updated.prepareStartedAt ? new Date(updated.prepareStartedAt) : undefined,
        readyAt: updated.readyAt ? new Date(updated.readyAt) : undefined,
        deliveredAt: updated.deliveredAt ? new Date(updated.deliveredAt) : undefined,
        cancelledAt: updated.cancelledAt ? new Date(updated.cancelledAt) : undefined,
        cancelAcknowledgedAt: updated.cancelAcknowledgedAt ? new Date(updated.cancelAcknowledgedAt) : undefined,
      } as Order;
      setOrders(prev => prev.map(o => (o.id === id ? normalized : o)));
    } catch (err) {
      console.error('acknowledgeCancelledOrder failed', err);
    }
  }, [API_BASE, authHeaders, logout]);

  const getOrdersByStatus = useCallback((status: OrderStatus) => {
    return orders.filter(o => o.status === status);
  }, [orders]);

  const getAveragePrepTime = useCallback(() => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

    const completed = orders
      .map(order => {
        const started = order.startedAt || order.prepareStartedAt;
        const finished = order.finishedAt || order.readyAt;
        if (!started || !finished) return null;

        const finishedAtMs = finished.getTime();
        if (finishedAtMs < dayStart || finishedAtMs > dayEnd) return null;

        const delta = finished.getTime() - started.getTime();
        return delta > 0 ? delta : null;
      })
      .filter((delta): delta is number => delta !== null);

    if (completed.length === 0) return 0;
    const totalMs = completed.reduce((sum, delta) => sum + delta, 0);
    const averageMin = totalMs / completed.length / 60000;
    return Math.round(averageMin);
  }, [orders]);

  // Atualiza status por item com estratégia otimista + confirmação no backend.
  const updateItemStatus = useCallback((orderId: string, itemId: string, itemStatus: ItemStatus, itemIndex?: number) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      let hasUpdatedById = false;
      return {
        ...o,
        items: o.items.map((it, idx) => {
          if (typeof itemIndex === 'number') {
            return idx === itemIndex ? { ...it, itemStatus } : it;
          }

          if (!hasUpdatedById && it.id === itemId) {
            hasUpdatedById = true;
            return { ...it, itemStatus };
          }

          return it;
        }),
      };
    }));

    fetch(`${API_BASE}/orders/${orderId}/items/${itemId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ itemStatus, ...(typeof itemIndex === 'number' ? { itemIndex } : {}) }),
    }).catch(err => console.error('updateItemStatus failed', err));
  }, [API_BASE, authHeaders]);

  // Carrega snapshot inicial e mantém estado vivo pelos eventos do Socket.IO.
  useEffect(() => {
    if (!isAuthenticated) {
      setOrders([]);
      return;
    }

    let socket: Socket | null = null;
    const fetchOrders = async () => {
      try {
        const resp = await fetch(`${API_BASE}/orders`, { headers: authHeaders });
        if (resp.status === 401) {
          logout();
          return;
        }
        if (resp.ok) {
          const data: Order[] = await resp.json();
          const normalized = data.map(d => ({
            ...d,
            externalId: (d as any).externalId || null,
            customerName: getDisplayCustomerName(d.customerName),
            serviceMode: normalizeServiceMode((d as any).serviceMode ?? (d as any).modality ?? (d as any).tipoAtendimento),
            cookId: d.cookId || null,
            createdAt: new Date(d.createdAt),
            updatedAt: new Date(d.updatedAt),
            acceptedAt: d.acceptedAt ? new Date(d.acceptedAt) : undefined,
            startedAt: d.startedAt ? new Date(d.startedAt) : undefined,
            finishedAt: d.finishedAt ? new Date(d.finishedAt) : undefined,
            prepareStartedAt: d.prepareStartedAt ? new Date(d.prepareStartedAt) : undefined,
            readyAt: d.readyAt ? new Date(d.readyAt) : undefined,
            deliveredAt: d.deliveredAt ? new Date(d.deliveredAt) : undefined,
            cancelledAt: d.cancelledAt ? new Date(d.cancelledAt) : undefined,
            cancelAcknowledgedAt: d.cancelAcknowledgedAt ? new Date(d.cancelAcknowledgedAt) : undefined,
          } as Order));
          setOrders(dedupeOrders(normalized.filter(order => isOrderAllowedByServiceMode(order))));
        }
      } catch (err) {
        console.warn('Could not load orders from API', err);
      }
    };

    fetchOrders(); // carga inicial

    // Setores são auxiliares para as abas da cozinha; falha aqui não bloqueia operação.
    fetch(`${API_BASE}/sectors`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : [])
      .then((data: Sector[]) => { if (Array.isArray(data)) setSectors(data); })
      .catch(() => {});

    try {
      socket = io(API_BASE, {
        transports: ['websocket'],
        auth: { token },
      });
      socket.on('connect', () => {
        console.debug('socket connected', socket?.id);
      });

      socket.on('orders:created', (o: Order) => {
        const normalized = {
          ...o,
          externalId: (o as any).externalId || null,
          customerName: getDisplayCustomerName(o.customerName),
          serviceMode: normalizeServiceMode((o as any).serviceMode ?? (o as any).modality ?? (o as any).tipoAtendimento),
          cookId: o.cookId || null,
          createdAt: new Date(o.createdAt),
          updatedAt: new Date(o.updatedAt),
          acceptedAt: o.acceptedAt ? new Date(o.acceptedAt) : undefined,
          startedAt: o.startedAt ? new Date(o.startedAt) : undefined,
          finishedAt: o.finishedAt ? new Date(o.finishedAt) : undefined,
          prepareStartedAt: o.prepareStartedAt ? new Date(o.prepareStartedAt) : undefined,
          readyAt: o.readyAt ? new Date(o.readyAt) : undefined,
          deliveredAt: o.deliveredAt ? new Date(o.deliveredAt) : undefined,
          cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : undefined,
          cancelAcknowledgedAt: o.cancelAcknowledgedAt ? new Date(o.cancelAcknowledgedAt) : undefined,
        } as Order;
        if (!isOrderAllowedByServiceMode(normalized)) {
          return;
        }
        setOrders(prev => {
          const alreadyExists = prev.some(order => getOrderIdentityKey(order) === getOrderIdentityKey(normalized));
          if (alreadyExists) {
            return replaceOrderByIdentity(prev, normalized);
          }

          // Toca som de novo pedido quando habilitado nas preferências.
          try {
            if (settings?.newOrderSoundEnabled && settings.newOrderSound) {
              const soundUrl = decodeURI(settings.newOrderSound);
              const a = new Audio(soundUrl);
              a.play().catch(() => {});
            }
          } catch (e) {}

          // Se preparo automático está ativado, adiciona à fila para processamento
          if (settings?.autoPrep && normalized.status === 'received') {
            autoPrepQueueRef.current.add(normalized.id);
          }

          return sortOrdersByCreatedAt([...prev, normalized]);
        });
      });

      socket.on('orders:updated', (o: Order) => {
        const normalized = {
          ...o,
          externalId: (o as any).externalId || null,
          customerName: getDisplayCustomerName(o.customerName),
          serviceMode: normalizeServiceMode((o as any).serviceMode ?? (o as any).modality ?? (o as any).tipoAtendimento),
          cookId: o.cookId || null,
          createdAt: new Date(o.createdAt),
          updatedAt: new Date(o.updatedAt),
          acceptedAt: o.acceptedAt ? new Date(o.acceptedAt) : undefined,
          startedAt: o.startedAt ? new Date(o.startedAt) : undefined,
          finishedAt: o.finishedAt ? new Date(o.finishedAt) : undefined,
          prepareStartedAt: o.prepareStartedAt ? new Date(o.prepareStartedAt) : undefined,
          readyAt: o.readyAt ? new Date(o.readyAt) : undefined,
          deliveredAt: o.deliveredAt ? new Date(o.deliveredAt) : undefined,
          cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : undefined,
          cancelAcknowledgedAt: o.cancelAcknowledgedAt ? new Date(o.cancelAcknowledgedAt) : undefined,
        } as Order;
        setOrders(prev => {
          const previousOrder = prev.find(order => getOrderIdentityKey(order) === getOrderIdentityKey(normalized));
          if (!isOrderAllowedByServiceMode(normalized)) {
            return prev.filter(order => getOrderIdentityKey(order) !== getOrderIdentityKey(normalized));
          }

          if (!previousOrder) {
            return sortOrdersByCreatedAt([...prev, normalized]);
          }

          // Som de pronto dispara apenas na transição para ready.
          try {
            if (normalized.status === 'ready' && previousOrder.status !== 'ready') {
              if (settings?.readyOrderSoundEnabled && settings.readyOrderSound) {
                const soundUrl = decodeURI(settings.readyOrderSound);
                const a = new Audio(soundUrl);
                a.play().catch(() => {});
              }
            }
          } catch (e) {}

          return replaceOrderByIdentity(prev, normalized);
        });
      });

      socket.on('orders:deleted', ({ id }: { id: string }) => {
        setOrders(prev => prev.filter(p => p.id !== id));
      });
    } catch (err) {
      console.warn('Could not connect socket', err);
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, [API_BASE, authHeaders, isAuthenticated, isOrderAllowedByServiceMode, logout, settings, token]);

  // Processa a fila de autoPrep quando novos pedidos chegam ou a fila muda
  useEffect(() => {
    if (autoPrepQueueRef.current.size === 0) return;

    // Processa cada pedido na fila
    const idsToProcess = Array.from(autoPrepQueueRef.current);
    autoPrepQueueRef.current.clear();

    idsToProcess.forEach(id => {
      // Verifica se o pedido ainda existe e está com status 'received'
      const order = orders.find(o => o.id === id);
      if (order && order.status === 'received') {
        updateStatus(id, 'preparing');
      }
    });
  }, [orders, updateStatus]);

  return (
    <OrderContext.Provider value={{ orders, sectors, addOrder, updateStatus, updateItemStatus, cancelOrder, acknowledgeCancelledOrder, getOrdersByStatus, getAveragePrepTime, printOrderTicket, reprintOrderTicket }}>
      {children}
    </OrderContext.Provider>
  );
}

export function useOrders() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error('useOrders must be used within OrderProvider');
  return ctx;
}
