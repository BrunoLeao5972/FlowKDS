import { useState } from 'react';
import { useOrders } from '@/contexts/OrderContext';
import { useSettings } from '@/contexts/SettingsContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2 } from 'lucide-react';

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewOrderDialog({ open, onOpenChange }: NewOrderDialogProps) {
  const { orders, addOrder } = useOrders();
  const [customerName, setCustomerName] = useState('');
  const [observations, setObservations] = useState('');
  const [items, setItems] = useState([{ name: '', quantity: 1 }]);

  const { computeNextNumber, orderNumberMode, lastResetDate, touchResetDate, customStartNumber } = useSettings();
  const nextNumber = computeNextNumber(orders);

  const handleSubmit = () => {
    if (!customerName.trim() || items.every(i => !i.name.trim())) return;
    addOrder({
      number: nextNumber,
      customerName: customerName.trim(),
      items: items.filter(i => i.name.trim()).map(i => ({
        id: (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`,
        name: i.name.trim(),
        quantity: i.quantity,
      })),
      observations: observations.trim(),
      status: 'received',
    });
    // if daily-reset is enabled and we didn't yet mark today as reset, touch it so next numbers keep incrementing for today
    if (orderNumberMode === 'daily-reset') {
      const today = new Date().toISOString().slice(0, 10);
      if (lastResetDate !== today) touchResetDate();
    }
    setCustomerName('');
    setObservations('');
    setItems([{ name: '', quantity: 1 }]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Pedido #{nextNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Nome do cliente"
            value={customerName}
            onChange={e => setCustomerName(e.target.value)}
          />
          <div className="space-y-2">
            <label className="text-sm font-medium">Itens</label>
            {items.map((item, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  className="w-16"
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={e => {
                    const next = [...items];
                    next[i].quantity = parseInt(e.target.value) || 1;
                    setItems(next);
                  }}
                />
                <Input
                  placeholder="Nome do item"
                  value={item.name}
                  onChange={e => {
                    const next = [...items];
                    next[i].name = e.target.value;
                    setItems(next);
                  }}
                  className="flex-1"
                />
                {items.length > 1 && (
                  <Button variant="ghost" size="icon" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setItems([...items, { name: '', quantity: 1 }])} className="gap-1">
              <Plus className="w-3 h-3" /> Adicionar item
            </Button>
          </div>
          <Textarea
            placeholder="Observações (opcional)"
            value={observations}
            onChange={e => setObservations(e.target.value)}
          />
          <Button onClick={handleSubmit} className="w-full">
            Criar Pedido
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
