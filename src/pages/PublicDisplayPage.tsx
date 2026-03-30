import { useOrders } from '@/contexts/OrderContext';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell } from 'lucide-react';
import { getDisplayCustomerName } from '@/lib/customerName';

export default function PublicDisplayPage() {
  const { orders } = useOrders();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  const preparingOrders = orders
    .filter(o => o.status === 'preparing')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const readyOrders = orders
    .filter(o => o.status === 'ready')
    .sort((a, b) => (b.readyAt?.getTime() || 0) - (a.readyAt?.getTime() || 0));

  return (
    <div className="min-h-screen flex flex-col p-6 md:p-10">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight">
          ACOMPANHE SEU PEDIDO
        </h1>
        <p className="text-muted-foreground mt-1 text-lg">
          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Preparing */}
        <div>
          <h2 className="text-xl font-bold mb-4 text-status-preparing flex items-center justify-center gap-2">
            🔥 EM PREPARO
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <AnimatePresence>
              {preparingOrders.map(order => (
                <motion.div
                  key={order.id}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="bg-card border border-border rounded-xl p-4 text-center"
                >
                  <span className="text-3xl md:text-4xl font-black">{order.number}</span>
                  {getDisplayCustomerName(order.customerName) && (
                    <p className="text-sm text-muted-foreground mt-1">{getDisplayCustomerName(order.customerName)}</p>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {preparingOrders.length === 0 && (
            <p className="text-muted-foreground text-center py-10">Nenhum pedido em preparo</p>
          )}
        </div>

        {/* Ready */}
        <div>
          <h2 className="text-xl font-bold mb-4 text-status-ready flex items-center justify-center gap-2">
            <Bell className="w-5 h-5" />
            PRONTO PARA RETIRADA
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <AnimatePresence>
              {readyOrders.map((order, i) => (
                <motion.div
                  key={order.id}
                  layout
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  className={`rounded-xl p-5 text-center border-2 border-status-ready bg-status-ready/10 ${
                    i === 0 ? 'animate-pulse-ready' : ''
                  }`}
                >
                  <div className="flex items-center justify-center gap-4">
                    <span className="text-5xl md:text-6xl font-black text-status-ready">
                      {order.number}
                    </span>
                  </div>
                  {getDisplayCustomerName(order.customerName) && (
                    <p className="text-lg font-medium mt-2">{getDisplayCustomerName(order.customerName)}</p>
                  )}
                  <p className="text-sm text-status-ready font-semibold mt-1">
                    RETIRE NO BALCÃO
                  </p>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {readyOrders.length === 0 && (
            <p className="text-muted-foreground text-center py-10">Nenhum pedido pronto</p>
          )}
        </div>
      </div>
    </div>
  );
}
