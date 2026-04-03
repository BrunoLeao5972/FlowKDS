import { useOrders } from '@/contexts/OrderContext';
import { Order, OrderStatus, STATUS_LABELS, OrderItem, ItemStatus } from '@/types/order';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ChefHat, CheckCircle2, Package, XCircle, Search, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';
import { getDisplayCustomerName } from '@/lib/customerName';

const statusConfig: Record<OrderStatus, { icon: React.ElementType; colorClass: string }> = {
  received: { icon: Package, colorClass: 'bg-status-received' },
  preparing: { icon: ChefHat, colorClass: 'bg-status-preparing' },
  ready: { icon: CheckCircle2, colorClass: 'bg-status-ready' },
  delivered: { icon: Clock, colorClass: 'bg-status-delivered' },
  cancelled: { icon: XCircle, colorClass: 'bg-status-cancelled' },
};

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  received: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
};

const PREV_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  preparing: 'received',
  ready: 'preparing',
  delivered: 'ready',
};

const PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 25, 30] as const;
const RECENT_HOURS_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

function formatItemNote(raw?: string) {
  const text = String(raw || '').trim();
  if (!text) return '';

  const htmlMatch = text.match(/HTML:\s*([\s\S]*)/i);
  if (htmlMatch && htmlMatch[1].trim()) return htmlMatch[1].trim();

  const fileMatch = text.match(/FILE:\s*([^\r\n]+)/i);
  if (fileMatch && fileMatch[1].trim()) return fileMatch[1].trim();

  return text;
}

function isWithinLastHours(date: Date, hours: number): boolean {
  return Date.now() - date.getTime() <= hours * 60 * 60 * 1000;
}

function getOrderReferenceDate(order: Order): Date {
  if (order.status === 'delivered') {
    return order.deliveredAt || order.updatedAt || order.createdAt;
  }

  return order.createdAt;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isOnDate(date: Date, yyyyMmDd: string): boolean {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  if (!year || !month || !day) return true;

  return (
    date.getFullYear() === year
    && date.getMonth() + 1 === month
    && date.getDate() === day
  );
}

function isWithinDateRange(date: Date, fromYyyyMmDd: string, toYyyyMmDd: string): boolean {
  const fromParts = fromYyyyMmDd.split('-').map(Number);
  const toParts = toYyyyMmDd.split('-').map(Number);

  if (fromParts.length !== 3 || toParts.length !== 3) return true;

  const [fromYear, fromMonth, fromDay] = fromParts;
  const [toYear, toMonth, toDay] = toParts;
  if (!fromYear || !fromMonth || !fromDay || !toYear || !toMonth || !toDay) return true;

  const fromDate = new Date(fromYear, fromMonth - 1, fromDay, 0, 0, 0, 0);
  const toDate = new Date(toYear, toMonth - 1, toDay, 23, 59, 59, 999);
  return date >= fromDate && date <= toDate;
}

function getEffectiveItemStatus(order: Order, item: OrderItem): ItemStatus {
  if (order.status === 'received') return 'waiting';
  if (order.status === 'ready') return 'ready';
  if (order.status === 'preparing') return item.itemStatus ?? 'preparing';
  return item.itemStatus ?? 'waiting';
}

function ItemStatusIcon({ status }: { status: ItemStatus }) {
  if (status === 'ready') return <CheckCircle2 className="w-3.5 h-3.5 text-status-ready" />;
  if (status === 'preparing') return <ChefHat className="w-3.5 h-3.5 text-status-preparing" />;
  return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
}

export default function AdminPage() {
  const { orders, updateStatus, cancelOrder, getOrdersByStatus, getAveragePrepTime, reprintOrderTicket } = useOrders();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [timeMode, setTimeMode] = useState<'recent' | 'older'>('recent');
  const [search, setSearch] = useState('');
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [ordersPerPage, setOrdersPerPage] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);
  const [recentHours, setRecentHours] = useState<(typeof RECENT_HOURS_OPTIONS)[number]>(3);
  const todayDate = useMemo(() => toDateInputValue(new Date()), []);
  const [olderDateFrom, setOlderDateFrom] = useState(todayDate);
  const [olderDateTo, setOlderDateTo] = useState(todayDate);
  const [, setTimeTick] = useState(0);

  const stats = [
    { label: 'Em Preparo', value: getOrdersByStatus('preparing').length, color: 'text-status-preparing', icon: ChefHat },
    { label: 'Prontos', value: getOrdersByStatus('ready').length, color: 'text-status-ready', icon: CheckCircle2 },
    { label: 'Entregues', value: getOrdersByStatus('delivered').length, color: 'text-status-delivered', icon: Package },
    { label: 'Tempo Médio', value: `${getAveragePrepTime()}min`, color: 'text-primary', icon: Clock },
  ];

  const isMobile = useIsMobile();

  useEffect(() => {
    const interval = setInterval(() => setTimeTick(v => v + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const filtered = orders
    .filter(o => filter === 'all' || o.status === filter)
    .filter(o => {
      const referenceDate = getOrderReferenceDate(o);

      if (timeMode === 'recent') {
        return isWithinLastHours(referenceDate, recentHours);
      }

      return isWithinDateRange(referenceDate, olderDateFrom, olderDateTo);
    })
    .filter(o => {
      if (!search) return true;
      const s = search.toLowerCase();
      return o.number.toString().includes(s) || o.customerName.toLowerCase().includes(s);
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const totalPages = Math.max(1, Math.ceil(filtered.length / ordersPerPage));
  const paginatedOrders = filtered.slice((currentPage - 1) * ordersPerPage, currentPage * ordersPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, search, ordersPerPage, timeMode, recentHours, olderDateFrom, olderDateTo]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const formatTime = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Painel Administrativo</h1>
          <p className="text-muted-foreground text-sm">Gerenciamento de pedidos</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map(s => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card rounded-lg p-4 border border-border"
          >
            <div className="flex items-center gap-2 mb-2">
              <s.icon className={`w-5 h-5 ${s.color}`} />
              <span className="text-sm text-muted-foreground">{s.label}</span>
            </div>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nº ou nome..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'received', 'preparing', 'ready', 'delivered', 'cancelled'] as const).map(s => (
            <Button
              key={s}
              variant={filter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(s)}
            >
              {s === 'all' ? 'Todos' : STATUS_LABELS[s]}
            </Button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={timeMode === 'recent' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeMode('recent')}
          >
            Últimos pedidos
          </Button>
          <Button
            variant={timeMode === 'older' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeMode('older')}
          >
            Pedidos anteriores
          </Button>
        </div>
        {timeMode === 'recent' ? (
          <div className="flex items-center gap-2">
            <label htmlFor="recent-hours" className="text-sm text-muted-foreground">Janela</label>
            <select
              id="recent-hours"
              value={recentHours}
              onChange={e => setRecentHours(Number(e.target.value) as (typeof RECENT_HOURS_OPTIONS)[number])}
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
            >
              {RECENT_HOURS_OPTIONS.map(option => (
                <option key={option} value={option}>
                  Últimas {option}h
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <label htmlFor="older-date-from" className="text-sm text-muted-foreground">De</label>
            <Input
              id="older-date-from"
              type="date"
              value={olderDateFrom}
              onChange={e => setOlderDateFrom(e.target.value || todayDate)}
              className="w-[160px] bg-card"
            />
            <label htmlFor="older-date-to" className="text-sm text-muted-foreground">Até</label>
            <Input
              id="older-date-to"
              type="date"
              value={olderDateTo}
              onChange={e => setOlderDateTo(e.target.value || todayDate)}
              className="w-[160px] bg-card"
            />
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <label htmlFor="orders-per-page" className="text-sm text-muted-foreground">Pedidos por página</label>
          <select
            id="orders-per-page"
            value={ordersPerPage}
            onChange={e => setOrdersPerPage(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
            className="h-10 rounded-md border border-input bg-card px-3 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders List / Table (responsive) */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {isMobile ? (
          <div className="p-3 space-y-3">
            <AnimatePresence>
              {paginatedOrders.map(order => {
                const cfg = statusConfig[order.status];
                const Icon = cfg.icon;
                return (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="p-3 bg-background rounded-lg border border-border/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-lg">{order.number}</span>
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-primary-foreground ${cfg.colorClass}`}>
                            <Icon className="w-3 h-3" />
                            {STATUS_LABELS[order.status]}
                          </span>
                        </div>
                        {getDisplayCustomerName(order.customerName) && (
                          <p className="text-sm text-muted-foreground">{getDisplayCustomerName(order.customerName)}</p>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">{formatTime(order.createdAt)}</div>
                    </div>

                    <div className="mt-2">
                      <div className="flex flex-wrap gap-2">
                        {order.items.map(it => {
                          const itemStatus = getEffectiveItemStatus(order, it);
                          return (
                            <Badge key={it.id} variant="secondary" className="text-xs inline-flex items-center gap-1.5">
                              <ItemStatusIcon status={itemStatus} />
                              {it.quantity}x {it.name}
                            </Badge>
                          );
                        })}
                      </div>
                      {order.observations && <p className="text-xs text-muted-foreground mt-2">{order.observations}</p>}
                    </div>

                    <div className="mt-3 flex flex-col gap-2">
                      <div className="flex gap-2">
                        {NEXT_STATUS[order.status] && (
                          <Button className="flex-1" onClick={() => updateStatus(order.id, NEXT_STATUS[order.status]!)}>
                            {STATUS_LABELS[NEXT_STATUS[order.status]!]} 
                          </Button>
                        )}
                        {PREV_STATUS[order.status] && (
                          <Button className="flex-1" variant="outline" onClick={() => updateStatus(order.id, PREV_STATUS[order.status]!)}>
                            Voltar
                          </Button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          className="flex-1"
                          variant="outline"
                          title="Reimprimir senha do pedido"
                          onClick={() => reprintOrderTicket(order)}
                        >
                          <Printer className="w-4 h-4 mr-1" />
                          Reimprimir
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        {order.status !== 'cancelled' && order.status !== 'delivered' && (
                          <Button
                            className="flex-1"
                            variant="destructive"
                            title="Clique duas vezes para confirmar"
                            onDoubleClick={() => {
                              cancelOrder(order.id);
                              setPendingCancelId(null);
                            }}
                            onClick={() => {
                              const id = order.id;
                              if (pendingCancelId === id) {
                                cancelOrder(id);
                                setPendingCancelId(null);
                              } else {
                                setPendingCancelId(id);
                                setTimeout(() => setPendingCancelId(prev => (prev === id ? null : prev)), 3000);
                              }
                            }}
                          >
                            {pendingCancelId === order.id ? 'Clique novamente para confirmar' : 'Cancelar'}
                          </Button>
                        )}

                        {order.status === 'cancelled' && (
                          <Button className="flex-1" variant="outline" onClick={() => updateStatus(order.id, 'received')}>
                            Voltar para produção
                          </Button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Pedido</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Cliente</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Itens</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden lg:table-cell">Obs</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Horário</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                  <th className="text-left p-4 text-sm font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {paginatedOrders.map(order => {
                    const cfg = statusConfig[order.status];
                    const Icon = cfg.icon;
                    return (
                      <motion.tr
                        key={order.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                      >
                        <td className="p-4 font-bold text-lg">{order.number}</td>
                        <td className="p-4">{getDisplayCustomerName(order.customerName)}</td>
                        <td className="p-4 hidden md:table-cell">
                          <div className="flex flex-col gap-1">
                            {order.items.map(item => {
                              const itemStatus = getEffectiveItemStatus(order, item);
                              return (
                                <div key={item.id} className="flex flex-col gap-0.5">
                                  <Badge variant="secondary" className="text-xs w-fit inline-flex items-center gap-1.5">
                                    <ItemStatusIcon status={itemStatus} />
                                    {item.quantity}x {item.name}
                                  </Badge>
                                  {formatItemNote(item.notes) && (
                                    <span className="text-[11px] text-muted-foreground pl-1">
                                      Obs item: {formatItemNote(item.notes)}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                        <td className="p-4 hidden lg:table-cell text-sm text-muted-foreground max-w-[200px] truncate">
                          {order.observations || '—'}
                        </td>
                        <td className="p-4 text-sm">{formatTime(order.createdAt)}</td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-primary-foreground ${cfg.colorClass}`}>
                            <Icon className="w-3 h-3" />
                            {STATUS_LABELS[order.status]}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            {NEXT_STATUS[order.status] && (
                              <Button
                                size="sm"
                                onClick={() => updateStatus(order.id, NEXT_STATUS[order.status]!)}
                              >
                                {STATUS_LABELS[NEXT_STATUS[order.status]!]} 
                              </Button>
                            )}
                            {PREV_STATUS[order.status] && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateStatus(order.id, PREV_STATUS[order.status]!)}
                              >
                                Voltar
                              </Button>
                            )}
                            {order.status !== 'cancelled' && order.status !== 'delivered' && (
                              <Button
                                size="sm"
                                variant="destructive"
                                title="Clique duas vezes para confirmar"
                                onDoubleClick={() => {
                                  cancelOrder(order.id);
                                  setPendingCancelId(null);
                                }}
                                onClick={() => {
                                  const id = order.id;
                                  if (pendingCancelId === id) {
                                    cancelOrder(id);
                                    setPendingCancelId(null);
                                  } else {
                                    setPendingCancelId(id);
                                    setTimeout(() => setPendingCancelId(prev => (prev === id ? null : prev)), 3000);
                                  }
                                }}
                              >
                                {pendingCancelId === order.id ? 'Clique novamente para confirmar' : 'Cancelar'}
                              </Button>
                            )}

                            {order.status === 'cancelled' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateStatus(order.id, 'received')}
                              >
                                Voltar para produção
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              title="Reimprimir senha do pedido"
                              onClick={() => reprintOrderTicket(order)}
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {filtered.length === 0
              ? 'Nenhum pedido encontrado'
              : `Mostrando ${((currentPage - 1) * ordersPerPage) + 1}-${Math.min(currentPage * ordersPerPage, filtered.length)} de ${filtered.length} pedidos`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Anterior
            </Button>
            <span className="text-sm text-muted-foreground">
              Página {currentPage} de {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Próxima
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
