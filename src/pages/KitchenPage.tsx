import { getResponsibleDisplayName } from '@/lib/customerName';
import { useOrders } from '@/contexts/OrderContext';
import { useSettings } from '@/contexts/SettingsContext';
import { Order, OrderItem, ItemStatus, STATUS_LABELS } from '@/types/order';
import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';
import type { SVGProps } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, AlertTriangle, Clock, ChefHat, Layers,
  Store, CreditCard, Bike, Package, Briefcase, Building, MapPin
} from 'lucide-react';
import type { ServiceMode } from '@/types/order';

// Tipo para agrupar pedidos por demanda
interface OrderDemand {
  demandId: string | null;
  orders: Order[];
  firstOrder: Order;
  createdAt: Date;
  status: 'received' | 'preparing' | 'ready' | 'delivered' | 'cancelled';
}

function getElapsedMinutes(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 60000);
}

function MesaTableIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 9l4-4h8l4 4" />
      <path d="M2 11h20" />
      <path d="M4 11v9" />
      <path d="M20 11v9" />
      <path d="M8 11v6h3v-6" />
      <path d="M16 11v6h-3v-6" />
    </svg>
  );
}

/** Retorna ícone e label para o tipo de atendimento (modalidade) */
function getServiceModeConfig(mode?: ServiceMode | null) {
  const configs: Record<ServiceMode, { icon: React.ElementType; label: string; color: string }> = {
    balcao: { icon: Store, label: 'Balcão', color: 'text-blue-500' },
    mesa: { icon: MesaTableIcon, label: 'Mesa', color: 'text-purple-500' },
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

function getKdsDemandHeaderNumber(order: Order): string {
  const mode = order.serviceMode;
  const usesLaunchSuffix = mode === 'balcao' || mode === 'delivery' || mode === 'encomenda';

  if (usesLaunchSuffix) {
    const digits = String(order.lancamentoId || '').replace(/\D/g, '');
    if (digits.length >= 3) {
      return digits.slice(-3);
    }
  }

  return String(order.number);
}

function buildDemandHeaderNumbers(orders: Order[]): string {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const order of orders) {
    const numberLabel = getKdsDemandHeaderNumber(order);
    if (seen.has(numberLabel)) continue;
    seen.add(numberLabel);
    values.push(numberLabel);
  }

  return values.join(', ');
}

const RECENT_WINDOW_HOURS = 3;

function isWithinLastHours(date: Date, hours: number): boolean {
  return Date.now() - date.getTime() <= hours * 60 * 60 * 1000;
}

/**
 * Agrupa pedidos por demandId (lote de pedidos lançados juntos).
 * Pedidos sem demandId são agrupados individualmente.
 */
function groupOrdersByDemand(orders: Order[]): OrderDemand[] {
  const groupMap = new Map<string, OrderDemand>();

  for (const order of orders) {
    // Usa demandId se disponível, caso contrário usa o ID do próprio pedido como chave única
    const key = order.demandId || order.id;
    
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        demandId: order.demandId || null,
        orders: [],
        firstOrder: order,
        createdAt: order.createdAt,
        status: order.status,
      });
    }

    const demand = groupMap.get(key)!;
    demand.orders.push(order);
    
    // Atualiza status e datas para refletir o estado da demanda
    if (order.createdAt < demand.createdAt) {
      demand.createdAt = order.createdAt;
      demand.firstOrder = order;
    }
    
    // Status é 'ready' se TODOS os pedidos estão ready
    // Status é 'cancelled' se QUALQUER pedido está cancelled
    if (order.status === 'cancelled') {
      demand.status = 'cancelled';
    } else if (demand.status !== 'cancelled') {
      if (order.status === 'preparing' && demand.status !== 'preparing') {
        demand.status = 'preparing';
      } else if (order.status === 'ready' && demand.status === 'received') {
        demand.status = 'ready';
      }
    }
  }

  return Array.from(groupMap.values())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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

  // Filtra pedidos ativos (recebidos, em preparo ou cancelados não reconhecidos)
  const activeOrders = orders
    .filter(o => (
      (o.status === 'received' || o.status === 'preparing' || (o.status === 'cancelled' && !o.cancelAcknowledgedAt)) &&
      isWithinLastHours(o.createdAt, RECENT_WINDOW_HOURS)
    ))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Agrupa os pedidos ativos por demanda (demandId)
  const activeDemands = groupOrdersByDemand(activeOrders);

  // Pedidos de cozinha (para contadores)
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

  // Filtra demandas para a aba ativa
  const demandsForTab = activeDemands.filter(demand => {
    if (activeTab === 'all') {
      // Comanda completa: mostra demandas com itens não-prontos
      return demand.orders.some(o => 
        o.status !== 'cancelled' || !o.cancelAcknowledgedAt
      );
    } else {
      // Setor específico: mostra demandas com itens daquele setor
      return demand.orders.some(o =>
        o.items.some(item => item.sectorId === activeTab)
      );
    }
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

  /** Obtém todos os itens da demanda, filtrados pelo setor ativo se necessário. */
  function visibleItemsInDemand(demand: OrderDemand): Array<{ item: OrderItem; itemIndex: number; orderId: string; order: Order }> {
    const allItems: Array<{ item: OrderItem; itemIndex: number; orderId: string; order: Order }> = [];

    for (const order of demand.orders) {
      order.items.forEach((item, itemIndex) => {
        if (activeTab === 'all') {
          // Comanda completa: mostra itens não-prontos
          if (order.status !== 'cancelled' && getEffectiveItemStatus(order, item) !== 'ready') {
            allItems.push({ item, itemIndex, orderId: order.id, order });
          }
        } else {
          // Setor específico: mostra itens daquele setor não-prontos
          if (item.sectorId === activeTab && getEffectiveItemStatus(order, item) !== 'ready') {
            allItems.push({ item, itemIndex, orderId: order.id, order });
          }
        }
      });
    }

    return allItems;
  }

  // Mantém consistência visual: pedido recebido não pode mostrar item em preparo.
  function getEffectiveItemStatus(order: Order, item: OrderItem): ItemStatus {
    if (order.status === 'received') return item.itemStatus ?? 'waiting';
    if (order.status === 'ready') return 'ready';
    return item.itemStatus ?? 'waiting';
  }

  /** Conta quantas demandas têm itens para um setor específico. */
  function countDemandsForSector(sectorId: string): number {
    return activeDemands.filter(demand =>
      demand.orders.some(o => o.items.some(it => it.sectorId === sectorId))
    ).length;
  }

  /** Marca todos os itens visíveis da demanda como prontos. */
  function markDemandItemsReady(demand: OrderDemand) {
    const itemsToUpdate = visibleItemsInDemand(demand)
      .filter(({ item, order }) => (item.itemStatus ?? 'waiting') !== 'ready');
    
    itemsToUpdate.forEach(({ item, itemIndex, orderId }) => {
      updateItemStatus(orderId, item.id, 'ready', itemIndex);
    });
  }

  /** Marca todos os itens visíveis da demanda como em preparo. */
  function markDemandItemsPreparing(demand: OrderDemand) {
    const itemsToUpdate = visibleItemsInDemand(demand)
      .filter(({ item }) => (item.itemStatus ?? 'waiting') !== 'preparing');
    
    itemsToUpdate.forEach(({ item, itemIndex, orderId }) => {
      updateItemStatus(orderId, item.id, 'preparing', itemIndex);
    });
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
            {activeDemands.length}
          </span>
        </button>

        {/* Abas dos setores */}
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
              {countDemandsForSector(sector.id)}
            </span>
          </button>
        ))}
      </div>

      {/* Grid de demandas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence>
          {demandsForTab.map(demand => {
            const minutes = getElapsedMinutes(demand.createdAt);
            const items = visibleItemsInDemand(demand);
            
            // Uma demanda é cancelada se TODOS os pedidos estão cancelados
            const isCancelled = demand.orders.every(o => o.status === 'cancelled');
            const isCritical = !isCancelled && minutes > tempoCritico;
            
            // Status efetivo da demanda
            const demandStatus = demand.status;
            const demandNumbers = buildDemandHeaderNumbers(demand.orders);
            
            // Item statuses
            const itemStatuses = items.map(({ item, order }) => getEffectiveItemStatus(order, item));
            const allWaiting = itemStatuses.length > 0 && itemStatuses.every(status => status === 'waiting');

            return (
              <motion.div
                key={demand.demandId || demand.orders[0].id}
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
                    <span className="text-2xl font-black">{demandNumbers}</span>
                    {(() => {
                      const modeConfig = getServiceModeConfig(demand.firstOrder.serviceMode);
                      if (!modeConfig) return null;
                      const ModeIcon = modeConfig.icon;
                      return (
                        <div
                          className={`flex items-center gap-1 px-2 py-1 rounded-md bg-muted border border-border ${modeConfig.color}`}
                          title={modeConfig.label}
                          aria-label={modeConfig.label}
                        >
                          <ModeIcon className="w-4 h-4" />
                          <span className="text-xs font-semibold hidden sm:inline">{modeConfig.label}</span>
                        </div>
                      );
                    })()}
                  </div>
                  <Timer startTime={demand.createdAt} colorClass={getTimerColor(minutes)} />
                </div>

                <p className="text-xs text-muted-foreground -mt-2">
                  Realizado às: {demand.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>

                {demand.demandId && (
                  <p className="text-xs text-muted-foreground -mt-2">
                    Pedido nº: {demand.demandId.split(':')[0]}
                  </p>
                )}

                {/* Status da demanda */}
                <div className={`inline-flex self-start items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  isCancelled ? 'bg-status-cancelled text-primary-foreground'
                  : demandStatus === 'received' ? 'bg-status-received text-primary-foreground'
                  : demandStatus === 'preparing' ? 'bg-status-preparing text-primary-foreground'
                  : 'bg-status-ready text-primary-foreground'
                }`}>
                  {isCancelled ? <AlertTriangle className="w-3.5 h-3.5" />
                    : demandStatus === 'received' ? <Clock className="w-3.5 h-3.5" />
                    : demandStatus === 'preparing' ? <ChefHat className="w-3.5 h-3.5" />
                    : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {STATUS_LABELS[demandStatus]}
                </div>

                {/* Responsável (garçom/mesa) */}
                {demand.firstOrder.attendant && demand.firstOrder.serviceMode && (
                  <p className={`text-sm font-semibold -mt-2 ${
                    demand.firstOrder.serviceMode === 'mesa' ? 'text-blue-600 dark:text-blue-400'
                    : demand.firstOrder.serviceMode === 'cartao' ? 'text-green-600 dark:text-green-400'
                    : demand.firstOrder.serviceMode === 'apartamento' ? 'text-indigo-600 dark:text-indigo-400'
                    : demand.firstOrder.serviceMode === 'servico' ? 'text-cyan-600 dark:text-cyan-400'
                    : 'text-muted-foreground'
                  }`}>
                    {getResponsibleDisplayName({
                      serviceMode: demand.firstOrder.serviceMode,
                      attendant: demand.firstOrder.attendant,
                      sellerName: demand.firstOrder.sellerName,
                    })}
                  </p>
                )}

                {demand.firstOrder.integratorName && (
                  <div className="-mt-2 inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-md border border-orange-200 bg-orange-50 text-orange-700 text-xs font-bold">
                    Integradora: {demand.firstOrder.integratorName}
                  </div>
                )}

                {/* Itens da demanda */}
                <div className="space-y-3 flex-1">
                  {items.map(({ item, itemIndex, orderId, order }, idx) => (
                    <div key={`${orderId}-${itemIndex}-${idx}`} className="space-y-1">
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
                                    orderId={orderId}
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

                {/* Observações */}
                {demand.orders.some(o => o.observations) && (
                  <div className="bg-secondary/50 rounded-lg p-3 text-sm">
                    <span className="font-semibold text-primary">OBS:</span>{' '}
                    {demand.orders.filter(o => o.observations).map(o => o.observations).join(' | ')}
                  </div>
                )}

                {/* Ação da demanda */}
                {isCancelled ? (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => {
                        // Reconhecer cancelamento de todos os pedidos da demanda
                        demand.orders.forEach(o => acknowledgeCancelledOrder(o.id));
                      }}
                      className="w-full py-3 rounded-lg bg-status-cancelled text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                    >
                      OK — Demanda Cancelada
                    </button>
                  </div>
                ) : activeTab !== 'all' && allWaiting ? (
                  <button
                    onClick={() => markDemandItemsPreparing(demand)}
                    className="w-full py-3 rounded-lg bg-status-preparing text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                  >
                    INICIAR PREPARO
                  </button>
                ) : demandStatus === 'received' ? (
                  <button
                    onClick={() => {
                      // Inicia todos os pedidos da demanda
                      demand.orders.forEach(o => updateStatus(o.id, 'preparing', username || undefined));
                    }}
                    className="w-full py-3 rounded-lg bg-status-preparing text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98]"
                  >
                    INICIAR PREPARO
                  </button>
                ) : demandStatus === 'preparing' && activeTab !== 'all' ? (
                  <button
                    onClick={() => markDemandItemsReady(demand)}
                    className="w-full py-3 rounded-lg bg-status-ready text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    ITEM PRONTO
                  </button>
                ) : demandStatus === 'preparing' && activeTab === 'all' ? (
                  <button
                    onClick={() => {
                      // Marca a demanda inteira como pronta (todos os pedidos)
                      demand.orders.forEach(o => updateStatus(o.id, 'ready'));
                    }}
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

      {demandsForTab.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <CheckCircle2 className="w-16 h-16 mb-4 text-status-ready" />
          <p className="text-xl font-medium">
            {activeTab === 'all' ? 'Nenhuma demanda pendente!' : `Nenhuma demanda para este setor`}
          </p>
          <p className="text-sm">
            {activeTab === 'all' ? 'Todas as demandas foram finalizadas' : 'Aguardando novos pedidos...'}
          </p>
        </div>
      )}
    </div>
  );
}
