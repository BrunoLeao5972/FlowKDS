import { useOrders } from '@/contexts/OrderContext';
import { useSettings } from '@/contexts/SettingsContext';
import { Order, OrderItem, ItemStatus, STATUS_LABELS } from '@/types/order';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, AlertTriangle, Clock, ChefHat, Layers,
  Store, Armchair, CreditCard, Bike, Package, Briefcase, Building, MapPin
} from 'lucide-react';
import type { ServiceMode } from '@/types/order';

function getElapsedMinutes(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 60000);
}

/** Retorna ícone e label para o tipo de atendimento (modalidade) */
function getServiceModeConfig(mode?: ServiceMode | null) {
  const configs: Record<ServiceMode, { icon: React.ElementType; label: string; color: string }> = {
    balcao: { icon: Store, label: 'Balcão', color: 'text-blue-500' },
    mesa: { icon: Armchair, label: 'Mesa', color: 'text-purple-500' },
    cartao: { icon: CreditCard, label: 'Cartão', color: 'text-green-500' },
    delivery: { icon: Bike, label: 'Delivery', color: 'text-orange-500' },
    encomenda: { icon: Package, label: 'Encomenda', color: 'text-pink-500' },
    servico: { icon: Briefcase, label: 'Serviço', color: 'text-cyan-500' },
    apartamento: { icon: Building, label: 'Apartamento', color: 'text-indigo-500' },
  };
  return mode && configs[mode] ? configs[mode] : null;
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
  itemIndex,
  orderId,
  current,
  disabled,
  onToggle,
}: {
  item: OrderItem;
  itemIndex: number;
  orderId: string;
  current: ItemStatus;
  disabled: boolean;
  onToggle: (orderId: string, itemId: string, next: ItemStatus, itemIndex?: number) => void;
}) {
  const next: ItemStatus = current === 'ready' ? 'waiting' : current === 'preparing' ? 'ready' : 'preparing';

  const cls = current === 'ready'
    ? 'bg-status-ready border-status-ready text-primary-foreground hover:brightness-95'
    : current === 'preparing'
    ? 'bg-status-preparing border-status-preparing text-primary-foreground hover:brightness-95'
    : 'bg-status-received border-status-received text-primary-foreground hover:brightness-95';

  return (
    <button
      onClick={() => onToggle(orderId, item.id, next, itemIndex)}
      disabled={disabled}
      title={disabled ? 'Status liberado apenas no setor do item e com pedido em preparo' : 'Alternar status do item'}
      className={`mt-1 w-9 h-9 inline-flex items-center justify-center rounded border transition-colors ${cls} ${disabled ? 'opacity-60 cursor-not-allowed hover:brightness-100' : ''}`}
    >
      {current === 'ready' ? <CheckCircle2 className="w-4 h-4" /> : current === 'preparing' ? <ChefHat className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
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

  const kitchenOrders = orders
    .filter(o => (
      (o.status === 'received' || o.status === 'preparing' || o.status === 'ready')
      && isWithinLastHours(o.createdAt, RECENT_WINDOW_HOURS)
    ));

  const totalKitchenCount = kitchenOrders.length;
  const preparingCount = kitchenOrders.filter(o => o.status === 'preparing').length;
  const readyCount = kitchenOrders.filter(o => o.status === 'ready').length;
  const lateCount = kitchenOrders.filter(o => (
    o.status !== 'ready' && getElapsedMinutes(o.createdAt) > tempoCritico
  )).length;

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
  function visibleItems(order: Order): Array<{ item: OrderItem; itemIndex: number }> {
    if (activeTab === 'all') {
      return order.items.map((item, itemIndex) => ({ item, itemIndex }));
    }

    return order.items
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item.sectorId === activeTab);
  }

  // Mantem consistencia visual: pedido recebido nao pode mostrar item em preparo.
  function getEffectiveItemStatus(order: Order, item: OrderItem): ItemStatus {
    if (order.status === 'received') return 'waiting';
    if (order.status === 'ready') return 'ready';
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
    const itemsToUpdate = visibleItems(order).filter(({ item }) => (item.itemStatus ?? 'waiting') !== 'ready');
    itemsToUpdate.forEach(({ item, itemIndex }) => updateItemStatus(order.id, item.id, 'ready', itemIndex));
  }

  /**
   * Em abas de setor, marca os itens visíveis daquele setor como 'preparing'.
   * Chamado quando clica "INICIAR PREPARO" por setor.
   */
  function markVisibleItemsPreparing(order: Order) {
    const itemsToUpdate = visibleItems(order).filter(({ item }) => (item.itemStatus ?? 'waiting') !== 'preparing');
    itemsToUpdate.forEach(({ item, itemIndex }) => updateItemStatus(order.id, item.id, 'preparing', itemIndex));
  }

  return (
    <div className="min-h-screen p-4 md:p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              🍳 Cozinha
            </h1>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" disabled className="px-2.5 py-1 rounded-md border border-border bg-card text-foreground text-xs font-semibold">
                Total: {totalKitchenCount}
              </button>
              <button type="button" disabled className="px-2.5 py-1 rounded-md border border-status-preparing/40 bg-status-preparing/10 text-foreground text-xs font-semibold">
                Em preparo: {preparingCount}
              </button>
              <button type="button" disabled className="px-2.5 py-1 rounded-md border border-status-ready/40 bg-status-ready/10 text-foreground text-xs font-semibold">
                Prontos: {readyCount}
              </button>
              <button type="button" disabled className="px-2.5 py-1 rounded-md border border-timer-danger/40 bg-timer-danger/10 text-foreground text-xs font-semibold">
                Atraso: {lateCount}
              </button>
            </div>
          </div>
        </div>
        <div className="text-right text-muted-foreground text-sm">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          {' • '}
          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
            const sectorItemStatuses = items.map(({ item }) => getEffectiveItemStatus(order, item));
            const allSectorWaiting = sectorItemStatuses.length > 0 && sectorItemStatuses.every(status => status === 'waiting');

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
                } p-4 flex flex-col gap-3`}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-3xl font-black">{order.number}</span>
                    {(() => {
                      const modeConfig = getServiceModeConfig(order.serviceMode);
                      if (!modeConfig) return null;
                      const ModeIcon = modeConfig.icon;
                      return (
                        <div
                          className={`flex items-center gap-1 px-2 py-1 rounded-md bg-muted border border-border ${modeConfig.color}`}
                          title={modeConfig.label}
                        >
                          <ModeIcon className="w-4 h-4" />
                          <span className="text-xs font-semibold hidden sm:inline">{modeConfig.label}</span>
                        </div>
                      );
                    })()}
                  </div>
                  <Timer startTime={order.createdAt} colorClass={getTimerColor(minutes)} />
                </div>

                {/* Status do pedido */}
                <div className={`inline-flex self-start items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  isCancelled ? 'bg-status-cancelled text-primary-foreground'
                  : order.status === 'received' ? 'bg-status-received text-primary-foreground'
                  : order.status === 'preparing' ? 'bg-status-preparing text-primary-foreground'
                  : 'bg-status-ready text-primary-foreground'
                }`}>
                  {isCancelled ? <AlertTriangle className="w-3.5 h-3.5" />
                    : order.status === 'received' ? <Clock className="w-3.5 h-3.5" />
                    : order.status === 'preparing' ? <ChefHat className="w-3.5 h-3.5" />
                    : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {STATUS_LABELS[order.status]}
                </div>

                {order.cookId && (
                  <p className="text-sm text-muted-foreground -mt-2">Cozinheiro: {order.cookId}</p>
                )}

                {order.attendant && order.serviceMode && (
                  <p className={`text-sm font-semibold -mt-2 ${
                    order.serviceMode === 'mesa' ? 'text-blue-600 dark:text-blue-400'
                    : order.serviceMode === 'cartao' ? 'text-green-600 dark:text-green-400'
                    : order.serviceMode === 'apartamento' ? 'text-indigo-600 dark:text-indigo-400'
                    : order.serviceMode === 'servico' ? 'text-cyan-600 dark:text-cyan-400'
                    : 'text-muted-foreground'
                  }`}>
                    {/* Para Mesa, Cartão e Apartamento: mostra nome do vendedor se disponível, senão o número */}
                    {order.serviceMode === 'mesa' && (order.sellerName || `Mesa ${order.attendant}`)}
                    {order.serviceMode === 'cartao' && (order.sellerName || `Cartão ${order.attendant}`)}
                    {order.serviceMode === 'apartamento' && (order.sellerName || `Apto ${order.attendant}`)}
                    {order.serviceMode === 'servico' && `Serviço ${order.attendant}`}
                    {(order.serviceMode === 'balcao' || order.serviceMode === 'delivery' || order.serviceMode === 'encomenda') && `Atendente: ${order.attendant}`}
                  </p>
                )}

                {/* Itens (filtrados pelo setor ativo) */}
                <div className="space-y-3 flex-1">
                  {items.map(({ item, itemIndex }) => (
                    <div key={`${item.id}-${itemIndex}`} className="space-y-1">
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
                                itemIndex={itemIndex}
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
                ) : activeTab !== 'all' && allSectorWaiting ? (
                  <button
                    onClick={() => {
                      // Em setor, inicia preparo apenas dos itens daquele setor.
                      markVisibleItemsPreparing(order);
                    }}
                    className="w-full py-3 rounded-lg bg-status-preparing text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                  >
                    INICIAR PREPARO
                  </button>
                ) : order.status === 'received' ? (
                  <button
                    onClick={() => updateStatus(order.id, 'preparing', username || undefined)}
                    className="w-full py-3 rounded-lg bg-status-preparing text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                  >
                    INICIAR PREPARO
                  </button>
                ) : order.status === 'preparing' && activeTab !== 'all' ? (
                  // Em visualização de setor + preparando: marca items visíveis como prontos
                  <button
                    onClick={() => markVisibleItemsReady(order)}
                    className="w-full py-3 rounded-lg bg-status-ready text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    ITEM PRONTO
                  </button>
                ) : order.status === 'preparing' && activeTab === 'all' ? (
                  // Em comanda completa + preparando: marca o pedido inteiro como pronto
                  <button
                    onClick={() => updateStatus(order.id, 'ready')}
                    className="w-full py-3 rounded-lg bg-status-ready text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    MARCAR COMO PRONTO
                  </button>
                ) : null}
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
