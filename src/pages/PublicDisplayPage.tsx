import { useOrders } from '@/contexts/OrderContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSettings, ServiceMode } from '@/contexts/SettingsContext';
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell } from 'lucide-react';
import { getDisplayCustomerName, getPanelCustomerName } from '@/lib/customerName';

const RECENT_WINDOW_HOURS = 3;
const SECRET_THEME_CODE = '190';
const ALL_SERVICE_MODES: ServiceMode[] = ['balcao', 'mesa', 'cartao', 'delivery', 'encomenda', 'servico', 'apartamento'];

function isWithinLastHours(date: Date, hours: number): boolean {
  return Date.now() - date.getTime() <= hours * 60 * 60 * 1000;
}

function normalizeServiceMode(value: unknown): ServiceMode | null {
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
  };

  return aliases[normalized] || null;
}

/**
 * Retorna o número a exibir para o pedido no painel de retirada.
 * Para balcao/delivery/encomenda: últimos 3 dígitos do lancamentoId
 * Para outros: order.number
 */
function getDisplayOrderNumber(order: any): string {
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
      {getDisplayCustomerName(order.customerName) ? (
        <>
          <span
            className="text-4xl md:text-5xl font-black block"
            style={{ color: variant === 'preparing' ? 'var(--color-primary)' : 'var(--color-success)' }}
          >
            {getDisplayOrderNumber(order)}
          </span>
          <p className="text-base md:text-lg mt-1 tema-text-secondary font-medium break-words">
            {getPanelCustomerName(order.customerName)}
          </p>
        </>
      ) : (
        <span
          className="text-[2.5rem] md:text-[3.2rem] font-black block py-1"
          style={{ color: variant === 'preparing' ? 'var(--color-primary)' : 'var(--color-success)' }}
        >
          {getDisplayOrderNumber(order)}
        </span>
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
  const settings = useSettings();
  const [, setTick] = useState(0);
  const [secretBuffer, setSecretBuffer] = useState('');
  const [showModeFeedback, setShowModeFeedback] = useState(false);
  const prevReadyIdsRef = useRef<Set<string>>(new Set());
  const panelCallAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingPanelCallRef = useRef(false);

  const resolveSoundUrl = (raw: string) => {
    try {
      return decodeURI(raw);
    } catch {
      return raw;
    }
  };

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

  const normalizedPanelModes = useMemo(() => {    const configured = (settings.panelEnabledServiceModes || [])
      .map(mode => normalizeServiceMode(mode))
      .filter((mode): mode is ServiceMode => !!mode);

    return configured.length ? configured : ['balcao', 'delivery', 'encomenda'];
  }, [settings.panelEnabledServiceModes]);

  const isDisplayMode = (mode?: string | null) => {
    const normalizedMode = normalizeServiceMode(mode);
    if (!normalizedMode) return true;
    const effectiveModes = normalizedPanelModes.length ? normalizedPanelModes : ALL_SERVICE_MODES;
    return effectiveModes.includes(normalizedMode);
  };

  const preparingOrders = orders
    .filter(o => o.status === 'preparing' && isDisplayMode(o.serviceMode) && isWithinLastHours(o.createdAt, RECENT_WINDOW_HOURS))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const readyOrders = orders
    .filter(o => o.status === 'ready' && isDisplayMode(o.serviceMode) && isWithinLastHours(o.createdAt, RECENT_WINDOW_HOURS))
    .sort((a, b) => (b.readyAt?.getTime() || 0) - (a.readyAt?.getTime() || 0));

  // Mantém um único elemento de áudio pré-carregado para reduzir bloqueios e latência.
  useEffect(() => {
    if (!settings.panelCallSoundEnabled || !settings.panelCallSound) {
      panelCallAudioRef.current = null;
      pendingPanelCallRef.current = false;
      return;
    }

    const audio = new Audio(resolveSoundUrl(settings.panelCallSound));
    audio.preload = 'auto';
    panelCallAudioRef.current = audio;
    pendingPanelCallRef.current = false;

    return () => {
      panelCallAudioRef.current = null;
    };
  }, [settings.panelCallSoundEnabled, settings.panelCallSound]);

  // Se autoplay for bloqueado, reexecuta ao primeiro gesto do usuário na tela do painel.
  useEffect(() => {
    const tryReplayAfterInteraction = () => {
      if (!pendingPanelCallRef.current) return;
      const audio = panelCallAudioRef.current;
      if (!audio) return;

      audio.currentTime = 0;
      audio.play()
        .then(() => {
          pendingPanelCallRef.current = false;
        })
        .catch(() => {
          // Mantém pendente até uma interação subsequente.
        });
    };

    window.addEventListener('pointerdown', tryReplayAfterInteraction, { passive: true });
    window.addEventListener('keydown', tryReplayAfterInteraction);

    return () => {
      window.removeEventListener('pointerdown', tryReplayAfterInteraction);
      window.removeEventListener('keydown', tryReplayAfterInteraction);
    };
  }, []);

  // Toca o som de chamada no painel sempre que um novo pedido ficar pronto.
  useEffect(() => {
    const currentIds = new Set(readyOrders.map(o => o.id));
    const prev = prevReadyIdsRef.current;
    const hasNew = readyOrders.some(o => !prev.has(o.id));
    prevReadyIdsRef.current = currentIds;

    if (hasNew && settings.panelCallSoundEnabled && settings.panelCallSound) {
      const audio = panelCallAudioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play()
          .then(() => {
            pendingPanelCallRef.current = false;
          })
          .catch(() => {
            pendingPanelCallRef.current = true;
          });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyOrders.map(o => o.id).join(','), settings.panelCallSoundEnabled, settings.panelCallSound]);

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
