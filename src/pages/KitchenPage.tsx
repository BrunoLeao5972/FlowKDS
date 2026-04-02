import { useOrders } from '@/contexts/OrderContext';
import { useSettings } from '@/contexts/SettingsContext';
import { Order, OrderItem, ItemStatus, STATUS_LABELS } from '@/types/order';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Clock, ChefHat, Layers } from 'lucide-react';

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

const RECENT_WINDOW_HOURS = 3;

function isWithinLastHours(date: Date, hours: number): boolean {
  return Date.now() - date.getTime() <= hours * 60 * 60 * 1000;
}

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

/** Botão de toggle de status por item (visão de comanda completa e setores). */
function ItemStatusToggle({
  item,
  orderId,
  current,
  disabled,
  onToggle,
}: {
  item: OrderItem;
  orderId: string;
  current: ItemStatus;
  disabled: boolean;
  onToggle: (orderId: string, itemId: string, next: ItemStatus) => void;
}) {
  const next: ItemStatus = current === 'ready' ? 'waiting' : current === 'preparing' ? 'ready' : 'preparing';

  const cls = current === 'ready'
    ? 'bg-status-ready/10 border-status-ready/50 text-status-ready hover:bg-status-ready/20'
    : current === 'preparing'
    ? 'bg-status-preparing/10 border-status-preparing/50 text-status-preparing hover:bg-status-preparing/20'
    : 'bg-muted/60 border-border text-muted-foreground hover:bg-muted';

  return (
    <button
      onClick={() => onToggle(orderId, item.id, next)}
      disabled={disabled}
      title={disabled ? 'Status liberado apenas no setor do item e com pedido em preparo' : 'Alternar status do item'}
      className={`mt-1 w-8 h-8 inline-flex items-center justify-center rounded border transition-colors ${cls} ${disabled ? 'opacity-40 cursor-not-allowed hover:bg-inherit' : ''}`}
    >
      {current === 'ready' ? <CheckCircle2 className="w-3.5 h-3.5" /> : current === 'preparing' ? <ChefHat className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function KitchenPage() {
  const { orders, sectors, updateStatus, updateItemStatus, acknowledgeCancelledOrder } = useOrders();
  const { username } = useAuth();
  const { tempoAlerta, tempoCritico, animationsEnabled } = useSettings();
  const [, setTick] = useState(0);
  // 'all' = Comanda Completa; qualquer outro valor = sectorId
  const [activeTab, setActiveTab] = useState<'all' | string>('all');

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const activeOrders = orders
    .filter(o => (
      (o.status === 'received' || o.status === 'preparing' || (o.status === 'cancelled' && !o.cancelAcknowledgedAt)) &&
      isWithinLastHours(o.createdAt, RECENT_WINDOW_HOURS)
    ))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Pedidos filtrados para a aba de setor ativo (exclui pedidos sem itens daquele setor e pedidos com todos os itens do setor já prontos)
  const ordersForTab = activeTab === 'all'
    ? activeOrders
    : activeOrders.filter(o => {
        const sectorItems = o.items.filter(it => it.sectorId === activeTab);
        if (sectorItems.length === 0) return false;
        if (o.status === 'cancelled') return true;
        return sectorItems.some(it => getEffectiveItemStatus(o, it) !== 'ready');
      });

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

  /** Filtra itens de um pedido conforme a aba ativa. */
  function visibleItems(order: Order): OrderItem[] {
    if (activeTab === 'all') return order.items;
    return order.items.filter(it => it.sectorId === activeTab);
  }

  // O ícone do item obedece ao status principal do pedido.
  function getEffectiveItemStatus(order: Order, item: OrderItem): ItemStatus {
    if (order.status === 'received') return 'waiting';
    if (order.status === 'ready') return 'ready';
    if (order.status === 'preparing') return item.itemStatus ?? 'preparing';
    return item.itemStatus ?? 'waiting';
  }

  /** Conta quantos pedidos têm pelo menos um item naquele setor. */
  function countForSector(sectorId: string): number {
    return activeOrders.filter(o => o.items.some(it => it.sectorId === sectorId)).length;
  }

  /**
   * Em abas de setor, o botão principal finaliza apenas os itens visíveis daquele setor.
   * A finalização do pedido completo continua restrita à aba "Comanda Completa".
   */
  function markVisibleItemsReady(order: Order) {
    const itemsToUpdate = visibleItems(order).filter(item => (item.itemStatus ?? 'waiting') !== 'ready');
    itemsToUpdate.forEach(item => updateItemStatus(order.id, item.id, 'ready'));
  }

  return (
    <div className="min-h-screen p-4 md:p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
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

      {/* Navegação de setores */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {/* Aba Comanda Completa */}
        <button
          onClick={() => setActiveTab('all')}
          className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-semibold transition-all ${
            activeTab === 'all'
              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
              : 'bg-card text-foreground border-border hover:bg-muted'
          }`}
        >
          <Layers className="w-4 h-4" />
          Comanda Completa
          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
            activeTab === 'all' ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}>
            {activeOrders.length}
          </span>
        </button>

        {/* Abas dos setores vindos do SQL */}
        {sectors.map(sector => (
          <button
            key={sector.id}
            onClick={() => setActiveTab(sector.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-semibold transition-all ${
              activeTab === sector.id
                ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                : 'bg-card text-foreground border-border hover:bg-muted'
            }`}
          >
            {sector.name}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
              activeTab === sector.id ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'
            }`}>
              {countForSector(sector.id)}
            </span>
          </button>
        ))}
      </div>

      {/* Grid de pedidos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence>
          {ordersForTab.map(order => {
            const minutes = getElapsedMinutes(order.createdAt);
            const items = visibleItems(order);
            const isCancelled = order.status === 'cancelled';
            const isCritical = !isCancelled && minutes > tempoCritico;

            return (
              <motion.div
                key={`${order.id}-${activeTab}`}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, y: -20 }}
                className={`rounded-xl border-2 ${
                  isCancelled
                    ? 'border-status-cancelled bg-status-cancelled/10'
                    : isCritical && animationsEnabled
                    ? 'animate-pulse-danger border-timer-danger'
                    : `${getTimerBorder(minutes)} ${getTimerBg(minutes)}`
                } p-5 flex flex-col gap-4`}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-4xl font-black">{order.number}</span>
                  <Timer startTime={order.createdAt} colorClass={getTimerColor(minutes)} />
                </div>

                {/* Status do pedido */}
                <div className={`inline-flex self-start items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  isCancelled ? 'bg-status-cancelled text-primary-foreground'
                  : order.status === 'received' ? 'bg-status-received text-primary-foreground'
                  : order.status === 'preparing' ? 'bg-status-preparing text-primary-foreground'
                  : 'bg-status-ready text-primary-foreground'
                }`}>
                  {isCancelled ? <AlertTriangle className="w-3 h-3" />
                    : order.status === 'received' ? <Clock className="w-3 h-3" />
                    : order.status === 'preparing' ? <AlertTriangle className="w-3 h-3" />
                    : <CheckCircle2 className="w-3 h-3" />}
                  {STATUS_LABELS[order.status]}
                </div>

                {order.cookId && (
                  <p className="text-sm text-muted-foreground -mt-2">Cozinheiro: {order.cookId}</p>
                )}

                {/* Itens (filtrados pelo setor ativo) */}
                <div className="space-y-3 flex-1">
                  {items.map(item => (
                    <div key={item.id} className="space-y-1">
                      {(() => {
                        const itemStatus = getEffectiveItemStatus(order, item);
                        const canChangeItemStatus = order.status === 'preparing' && activeTab !== 'all' && item.sectorId === activeTab;

                        return (
                      <div className="flex items-start gap-2">
                        <span className="bg-secondary rounded-md w-7 h-7 flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
                          {item.quantity}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{item.name}</span>
                            {!isCancelled && (
                              <ItemStatusToggle
                                item={item}
                                orderId={order.id}
                                current={itemStatus}
                                disabled={!canChangeItemStatus}
                                onToggle={updateItemStatus}
                              />
                            )}
                          </div>
                          {formatItemNote(item.notes) && (
                            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                              Obs: {formatItemNote(item.notes)}
                            </p>
                          )}
                        </div>
                      </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>

                {/* Observações do pedido */}
                {order.observations && (
                  <div className="bg-secondary/50 rounded-lg p-3 text-sm">
                    <span className="font-semibold text-primary">OBS:</span> {order.observations}
                  </div>
                )}

                {/* Ação do pedido */}
                {isCancelled ? (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => acknowledgeCancelledOrder(order.id)}
                      className="w-full py-3 rounded-lg bg-status-cancelled text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                    >
                      OK — Pedido Cancelado
                    </button>
                  </div>
                ) : order.status === 'received' ? (
                  <button
                    onClick={() => updateStatus(order.id, 'preparing', username || undefined)}
                    className="w-full py-3 rounded-lg bg-status-preparing text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                  >
                    INICIAR PREPARO
                  </button>
                ) : activeTab !== 'all' ? (
                  <button
                    onClick={() => markVisibleItemsReady(order)}
                    className="w-full py-3 rounded-lg bg-status-ready text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    ITEM PRONTO
                  </button>
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

      {ordersForTab.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <CheckCircle2 className="w-16 h-16 mb-4 text-status-ready" />
          <p className="text-xl font-medium">
            {activeTab === 'all' ? 'Nenhum pedido pendente!' : `Nenhum pedido para este setor`}
          </p>
          <p className="text-sm">
            {activeTab === 'all' ? 'Todos os pedidos foram finalizados' : 'Aguardando novos pedidos...'}
          </p>
        </div>
      )}
    </div>
  );
}
