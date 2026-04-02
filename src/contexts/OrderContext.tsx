import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { Order, OrderStatus, Sector, ItemStatus } from '@/types/order';
import { useSettings } from './SettingsContext';
import { useAuth } from './AuthContext';
import { getDisplayCustomerName, getPrintableCustomerName } from '@/lib/customerName';

interface OrderContextType {
  orders: Order[];
  sectors: Sector[];
  addOrder: (order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateStatus: (id: string, status: OrderStatus, cookId?: string) => void;
  updateItemStatus: (orderId: string, itemId: string, itemStatus: ItemStatus) => void;
  cancelOrder: (id: string) => void;
  acknowledgeCancelledOrder: (id: string) => void;
  getOrdersByStatus: (status: OrderStatus) => Order[];
  getAveragePrepTime: () => number;
  printOrderTicket: (order: Order) => Promise<void>;
  reprintOrderTicket: (order: Order) => Promise<void>;
}

const OrderContext = createContext<OrderContextType | null>(null);

const INITIAL_ORDERS: Order[] = [];

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const settings = useSettings();
  const { token, isAuthenticated, logout } = useAuth();

  // Em produção, frontend e API usam o mesmo domínio.
  // No Vite local (5173), usa a API na porta 8081.
  const API_BASE = import.meta.env.VITE_API_BASE || (window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:8081`
    : window.location.origin);

  const authHeaders = useMemo(() => (token ? { 'x-kds-token': token } : {}), [token]);

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

  const buildTicketHtml = useCallback((order: Order, resolvedPrinterName: string) => {
    const createdAt = new Date(order.createdAt);
    const dateText = createdAt.toLocaleString('pt-BR');
    const customerName = getPrintableCustomerName(order.customerName);
    const ticketWidth = settings.printSize === '58mm' ? 220 : settings.printSize === '80mm' ? 300 : 420;
    const tradeName = settings.restaurantTradeName ? String(settings.restaurantTradeName).trim() : '';
    return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Senha ${order.number}</title>
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
      @media print { body { padding: 0; } .ticket { border: none; width: auto; } .hint { display: none; } }
    </style>
  </head>
  <body>
    <div class="ticket">
      ${tradeName ? `<div class="trade-name">${tradeName}</div>` : ''}
      <div class="title">SENHA DO PEDIDO</div>
      <div class="senha">${order.number}</div>
      <div class="line"><strong>Cliente:</strong> ${customerName}</div>
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

      // Fallback: se o popup estiver bloqueado, delega para o backend abrir HTML.
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
            customerName: createdOrder.customerName,
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
          customerName: createdOrder.customerName,
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
    try {
      await fetch(`${API_BASE}/print/ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          mode: resolved.mode,
          printerName: resolved.printerName,
          printSize: settings.printSize,
          printScale: settings.printScale,
          orderNumber: order.number,
          customerName: order.customerName,
          tradeName: settings.restaurantTradeName || '',
          items: order.items,
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
      const normalized = {
        ...created,
        customerName: getDisplayCustomerName(created.customerName),
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
    // Optimistic update: atualiza UI imediatamente
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

    // Sincroniza com servidor em background
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
    const completed = orders
      .map(order => {
        const started = order.startedAt || order.prepareStartedAt;
        const finished = order.finishedAt || order.readyAt;
        if (!started || !finished) return null;
        const delta = finished.getTime() - started.getTime();
        return delta > 0 ? delta : null;
      })
      .filter((delta): delta is number => delta !== null);

    if (completed.length === 0) return 0;
    const totalMs = completed.reduce((sum, delta) => sum + delta, 0);
    const averageMin = totalMs / completed.length / 60000;
    return Math.round(averageMin);
  }, [orders]);

  // Atualiza o status individual de um item (otimista + sincroniza com servidor).
  const updateItemStatus = useCallback((orderId: string, itemId: string, itemStatus: ItemStatus) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return {
        ...o,
        items: o.items.map(it => it.id === itemId ? { ...it, itemStatus } : it),
      };
    }));

    fetch(`${API_BASE}/orders/${orderId}/items/${itemId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ itemStatus }),
    }).catch(err => console.error('updateItemStatus failed', err));
  }, [API_BASE, authHeaders]);

  // Carrega pedidos e mantém sincronização em tempo real via socket.
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
            customerName: getDisplayCustomerName(d.customerName),
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
          setOrders(normalized);
        }
      } catch (err) {
        console.warn('Could not load orders from API', err);
      }
    };

    fetchOrders(); // carga inicial

    // Busca setores do servidor (não crítico, ignora falhas).
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
          customerName: getDisplayCustomerName(o.customerName),
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
          // Evita pedidos duplicados no estado local.
          if (prev.find(p => p.id === normalized.id)) return prev;
          // Toca som de novo pedido quando habilitado.
          try {
            if (settings?.newOrderSoundEnabled && settings.newOrderSound) {
              const a = new Audio(settings.newOrderSound);
              a.play().catch(() => {});
            }
          } catch (e) {}
          return [...prev, normalized].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        });
      });

      socket.on('orders:updated', (o: Order) => {
        const normalized = {
          ...o,
          customerName: getDisplayCustomerName(o.customerName),
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
        setOrders(prev => prev.map(p => {
          if (p.id === normalized.id) {
            // Toca som quando o pedido entra em "ready".
            try {
              if (normalized.status === 'ready' && p.status !== 'ready') {
                if (settings?.readyOrderSoundEnabled && settings.readyOrderSound) {
                  const a = new Audio(settings.readyOrderSound);
                  a.play().catch(() => {});
                }
              }
            } catch (e) {}
            return normalized;
          }
          return p;
        }));
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
  }, [API_BASE, authHeaders, isAuthenticated, logout, settings, token]);

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
