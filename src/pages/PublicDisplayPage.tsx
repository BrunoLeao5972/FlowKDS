import { useOrders } from '@/contexts/OrderContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell } from 'lucide-react';
import { getDisplayCustomerName } from '@/lib/customerName';

const RECENT_WINDOW_HOURS = 3;
const SECRET_THEME_CODE = '190';

function isWithinLastHours(date: Date, hours: number): boolean {
  return Date.now() - date.getTime() <= hours * 60 * 60 * 1000;
}

/**
 * Mantido como wrapper leve para a página pública.
 */
function ThemeLoadingGuard({ children }: React.PropsWithChildren) {
  return <>{children}</>;
}

/**
 * Componente de Pedido (card)
 */
interface OrderCardProps {
  order: any;
  variant: 'preparing' | 'ready';
}

function OrderCard({ order, variant }: OrderCardProps) {
  return (
    <motion.div
      layout
      initial={variant === 'preparing' ? { opacity: 0, scale: 0.8 } : { opacity: 0, x: 50 }}
      animate={variant === 'preparing' ? { opacity: 1, scale: 1 } : { opacity: 1, x: 0 }}
      exit={variant === 'preparing' ? { opacity: 0, scale: 0.8 } : { opacity: 0, x: -50 }}
      className={`
        rounded-xl p-4 text-center border-2 transition-all duration-300
        ${variant === 'preparing' 
          ? 'tema-card' 
          : 'tema-ready-card'
        }
      `}
    >
      <span
        className="text-3xl md:text-4xl font-black block"
        style={{ color: variant === 'preparing' ? 'var(--color-primary)' : 'var(--color-success)' }}
      >
        {order.number}
      </span>
      {getDisplayCustomerName(order.customerName) && (
        <p className="text-sm mt-1 tema-text-secondary">
          {getDisplayCustomerName(order.customerName)}
        </p>
      )}
      {variant === 'ready' && (
        <p className="text-sm font-semibold mt-1 tema-success">
          RETIRE NO BALCÃO
        </p>
      )}
    </motion.div>
  );
}

/**
 * Página Principal de Exibição Pública
 */
function PublicDisplayContent() {
  const { orders } = useOrders();
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [, setTick] = useState(0);
  const [secretBuffer, setSecretBuffer] = useState('');
  const [showModeFeedback, setShowModeFeedback] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!/^\d$/.test(event.key)) return;

      setSecretBuffer((current) => {
        const next = `${current}${event.key}`.slice(-SECRET_THEME_CODE.length);

        if (next === SECRET_THEME_CODE) {
          toggleDarkMode();
          setShowModeFeedback(true);
          return '';
        }

        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleDarkMode]);

  useEffect(() => {
    if (!showModeFeedback) return;

    const timeout = window.setTimeout(() => setShowModeFeedback(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [showModeFeedback]);

  const preparingOrders = orders
    .filter(o => o.status === 'preparing' && isWithinLastHours(o.createdAt, RECENT_WINDOW_HOURS))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const readyOrders = orders
    .filter(o => o.status === 'ready' && isWithinLastHours(o.createdAt, RECENT_WINDOW_HOURS))
    .sort((a, b) => (b.readyAt?.getTime() || 0) - (a.readyAt?.getTime() || 0));

  return (
    <div className="h-screen overflow-hidden flex flex-col p-6 pb-10 md:p-10 md:pb-10 tema-background">
      <AnimatePresence>
        {showModeFeedback && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="fixed right-4 top-4 z-50 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm"
          >
            {isDarkMode ? 'Modo escuro ativado' : 'Modo claro ativado'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight tema-primary">
          ACOMPANHE SEU PEDIDO
        </h1>
        <p className="mt-1 text-lg tema-text-secondary">
          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2">
        {/* Em Preparo */}
        <div className="md:pr-8 pb-8 md:pb-0 border-b-2 md:border-b-0 md:border-r-2 tema-border">
          <h2
            className="text-2xl md:text-3xl font-black mb-4 flex items-center justify-center gap-2"
            style={{ color: isDarkMode ? 'var(--color-warning)' : 'var(--color-primary)' }}
          >
            🔥 EM PREPARO
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <AnimatePresence>
              {preparingOrders.map(order => (
                <OrderCard key={order.id} order={order} variant="preparing" />
              ))}
            </AnimatePresence>
          </div>
          {preparingOrders.length === 0 && (
            <p className="text-center py-10 tema-text-secondary">Nenhum pedido em preparo</p>
          )}
        </div>

        {/* Prontos */}
        <div className="md:pl-8 pt-0 md:pt-0">
          <h2 className="text-2xl md:text-3xl font-black mb-4 flex items-center justify-center gap-2" style={{ color: '#16a34a' }}>
            <Bell className="w-5 h-5" />
            PRONTO PARA RETIRADA
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <AnimatePresence>
              {readyOrders.map(order => (
                <OrderCard key={order.id} order={order} variant="ready" />
              ))}
            </AnimatePresence>
          </div>
          {readyOrders.length === 0 && (
            <p className="text-center py-10 tema-text-secondary">Nenhum pedido pronto</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PublicDisplayPage() {
  return (
    <ThemeLoadingGuard>
      <PublicDisplayContent />
    </ThemeLoadingGuard>
  );
}
