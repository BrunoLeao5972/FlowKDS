import { useOrders } from '@/contexts/OrderContext';
import { useSettings } from '@/contexts/SettingsContext';
import { Order, STATUS_LABELS } from '@/types/order';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

function getElapsedMinutes(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 60000);
}

function formatItemNote(raw?: string) {
  const text = String(raw || '').trim();
  if (!text) return '';

  const htmlMatch = text.match(/HTML:\s*([\s\S]*)/i);
  if (htmlMatch && htmlMatch[1].trim()) return htmlMatch[1].trim();

  const fileMatch = text.match(/FILE:\s*([^\r\n]+)/i);
  if (fileMatch && fileMatch[1].trim()) return fileMatch[1].trim();

  return text;
}

// Timer display component now accepts an external color class

function Timer({ startTime, colorClass }: { startTime: Date; colorClass: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <span className={`font-mono text-2xl font-bold ${colorClass}`}>
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </span>
  );
}

export default function KitchenPage() {
  const { orders, updateStatus, acknowledgeCancelledOrder } = useOrders();
  const { tempoAlerta, tempoCritico } = useSettings();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const activeOrders = orders
    .filter(o => o.status === 'received' || o.status === 'preparing' || (o.status === 'cancelled' && !o.cancelAcknowledgedAt))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
            🍳 Cozinha
          </h1>
          <p className="text-muted-foreground text-sm">{activeOrders.length} pedidos ativos</p>
        </div>
        <div className="text-right text-muted-foreground text-sm">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence>
          {activeOrders.map(order => {
            const minutes = getElapsedMinutes(order.createdAt);

            function getTimerColor(minutes: number): string {
              if (minutes <= tempoAlerta) return 'text-timer-ok';
              if (minutes <= tempoCritico) return 'text-timer-warning';
              return 'text-timer-danger';
            }

            function getTimerBorder(minutes: number): string {
              if (minutes <= tempoAlerta) return 'border-timer-ok';
              if (minutes <= tempoCritico) return 'border-timer-warning';
              return 'border-timer-danger';
            }

            function getTimerBg(minutes: number): string {
              if (minutes <= tempoAlerta) return 'bg-timer-ok/10';
              if (minutes <= tempoCritico) return 'bg-timer-warning/10';
              return 'bg-timer-danger/20';
            }

            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, y: -20 }}
                className={`rounded-xl border-2 ${order.status === 'cancelled' ? 'border-status-cancelled bg-status-cancelled/10' : `${getTimerBorder(minutes)} ${getTimerBg(minutes)}`} p-5 flex flex-col gap-4`}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-4xl font-black">{order.number}</span>
                  <Timer startTime={order.createdAt} colorClass={getTimerColor(minutes)} />
                </div>

                {/* Status */}
                <div className={`inline-flex self-start items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  order.status === 'received' ? 'bg-status-received text-primary-foreground' : order.status === 'preparing' ? 'bg-status-preparing text-primary-foreground' : order.status === 'cancelled' ? 'bg-status-cancelled text-primary-foreground' : 'bg-status-ready text-primary-foreground'
                }`}>
                  {order.status === 'received' ? <Clock className="w-3 h-3" /> : order.status === 'preparing' ? <AlertTriangle className="w-3 h-3" /> : order.status === 'cancelled' ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                  {STATUS_LABELS[order.status]}
                </div>

                {/* Customer */}
                <p className="text-sm text-muted-foreground">{order.customerName}</p>

                {/* Items */}
                <div className="space-y-1.5 flex-1">
                  {order.items.map(item => (
                    <div key={item.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="bg-secondary rounded-md w-7 h-7 flex items-center justify-center text-sm font-bold">
                          {item.quantity}
                        </span>
                        <span className="text-sm font-medium">{item.name}</span>
                      </div>
                      {formatItemNote(item.notes) && (
                        <p className="text-xs text-muted-foreground pl-9 leading-tight">
                          Obs item: {formatItemNote(item.notes)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Observations */}
                {order.observations && (
                  <div className="bg-secondary/50 rounded-lg p-3 text-sm">
                    <span className="font-semibold text-primary">OBS:</span> {order.observations}
                  </div>
                )}

                {/* Action */}
                {order.status === 'received' ? (
                  <button
                    onClick={() => updateStatus(order.id, 'preparing')}
                    className="w-full py-3 rounded-lg bg-status-preparing text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                  >
                    INICIAR PREPARO
                  </button>
                ) : order.status === 'cancelled' ? (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => acknowledgeCancelledOrder(order.id)}
                      className="w-full py-3 rounded-lg bg-status-cancelled text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                    >
                      OK
                    </button>
                    <p className="text-xs text-muted-foreground">Pedido cancelado — pressione OK para confirmar ciência.</p>
                  </div>
                ) : (
                  <button
                    onClick={() => updateStatus(order.id, 'ready')}
                    className="w-full py-3 rounded-lg bg-status-ready text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    MARCAR COMO PRONTO
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {activeOrders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <CheckCircle2 className="w-16 h-16 mb-4 text-status-ready" />
          <p className="text-xl font-medium">Nenhum pedido pendente!</p>
          <p className="text-sm">Todos os pedidos foram finalizados</p>
        </div>
      )}
    </div>
  );
}
