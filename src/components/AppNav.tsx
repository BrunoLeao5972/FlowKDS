import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, ChefHat, Monitor, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import ThemeToggle from './ThemeToggle';

import { useState } from 'react';
import ConfigDialog from './ConfigDialog';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';

const links = [
  { to: '/', label: 'Admin', icon: LayoutDashboard, permission: 'admin' },
  { to: '/kitchen', label: 'Cozinha', icon: ChefHat, permission: 'kitchen' },
  { to: '/display', label: 'Painel', icon: Monitor, permission: 'display' },
];

export function AppNav() {
  const { pathname } = useLocation();
  const { logout, username, hasPermission } = useAuth();
  const displayUsername = username
    ? username
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
    : 'Usuario';
  const [showConfig, setShowConfig] = useState(false);
  const {
    tempoMedio,
    tempoAlerta,
    tempoCritico,
    setTempoMedio,
    setTempoAlerta,
    setTempoCritico,
    orderNumberMode,
    customStartNumber,
    setOrderNumberMode,
    setCustomStartNumber,
    touchResetDate,
    setRestaurantTradeName,
    setRestaurantLegalName,
    setRestaurantCnpj,
    setRestaurantCep,
    setRestaurantStreet,
    setRestaurantNumber,
    setRestaurantCity,
    setRestaurantComplement,
    setLicenseFileName,
    setLicenseContent,
    setNewOrderSound,
    setReadyOrderSound,
    setNewOrderSoundEnabled,
    setReadyOrderSoundEnabled,
    setPrinterName,
    setPrintSize,
    setPrintScale,
    enabledServiceModes,
    setEnabledServiceModes,
  } = useSettings();

  const getApiBase = () => {
    if (window.location.port === '5173') {
      return `${window.location.protocol}//${window.location.hostname}:8081`;
    }
    return window.location.origin;
  };

  const saveRestaurantSettings = async (payload: {
    tradeName: string;
    legalName: string;
    cnpj: string;
    cep: string;
    street: string;
    number: string;
    city: string;
    complement: string;
  }) => {
    try {
      const token = localStorage.getItem('kds_auth_token') || '';
      const response = await fetch(`${getApiBase()}/settings/restaurant`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-kds-token': token } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.error('Falha ao persistir dados do restaurante no banco');
      }
    } catch (error) {
      console.error('Erro ao persistir dados do restaurante no banco', error);
    }
  };
  
  // Hide nav on public display
  if (pathname === '/display' || pathname === '/login') return null;

  return (
    <>
      <nav className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-1 px-4 h-14">
          <span className="font-black text-lg text-primary mr-4">🔥Flow KDS</span>
          {links.filter(link => hasPermission(link.permission)).map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname === link.to
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              <link.icon className="w-4 h-4" />
              {link.label}
            </Link>
          ))}
          {hasPermission('settings') && (
            <button
              className="ml-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-secondary hover:bg-orange-500 hover:text-white transition-colors"
              onClick={() => setShowConfig(true)}
            >
              <Settings className="w-4 h-4" />
              Configurações
            </button>
          )}
          <div className="ml-auto" />
          <span className="text-sm text-muted-foreground ml-3 hidden sm:inline">{displayUsername}</span>
          <button
            className="ml-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            onClick={logout}
            type="button"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </nav>

      {showConfig && (
        <ConfigDialog
          tempoMedio={tempoMedio}
          tempoCritico={tempoCritico}
          tempoAlerta={tempoAlerta}
          orderNumberMode={orderNumberMode}
          customStartNumber={customStartNumber}
          onSave={(
            medio,
            critico,
            alerta,
            orderMode,
            startNumber,
            restaurantTradeName,
            restaurantLegalName,
            restaurantCnpj,
            restaurantCep,
            restaurantStreet,
            restaurantNumber,
            restaurantCity,
            restaurantComplement,
            licenseFileName,
            licenseContent,
            newOrderSound,
            readyOrderSound,
            newOrderEnabled,
            readyEnabled,
            printerName,
            printSize,
            printScale,
            serviceModes
          ) => {
            setTempoMedio(medio);
            setTempoCritico(critico);
            setTempoAlerta(alerta);
            setOrderNumberMode(orderMode);
            setCustomStartNumber(startNumber);
            setRestaurantTradeName(restaurantTradeName);
            setRestaurantLegalName(restaurantLegalName);
            setRestaurantCnpj(restaurantCnpj);
            setRestaurantCep(restaurantCep);
            setRestaurantStreet(restaurantStreet);
            setRestaurantNumber(restaurantNumber);
            setRestaurantCity(restaurantCity);
            setRestaurantComplement(restaurantComplement);
            void saveRestaurantSettings({
              tradeName: restaurantTradeName,
              legalName: restaurantLegalName,
              cnpj: restaurantCnpj,
              cep: restaurantCep,
              street: restaurantStreet,
              number: restaurantNumber,
              city: restaurantCity,
              complement: restaurantComplement,
            });
            setLicenseFileName(licenseFileName);
            setLicenseContent(licenseContent);
            // persist sound settings
            setNewOrderSound(newOrderSound);
            setReadyOrderSound(readyOrderSound);
            setNewOrderSoundEnabled(!!newOrderEnabled);
            setReadyOrderSoundEnabled(!!readyEnabled);
            setPrinterName(printerName);
            setPrintSize(printSize);
            setPrintScale(115);
            setEnabledServiceModes(serviceModes);
            // if user enabled daily-reset or custom-start, update last reset date to today so numbering starts immediately
            if (orderMode === 'daily-reset' || orderMode === 'custom-start') touchResetDate();
            setShowConfig(false);
          }}
          ThemeToggle={<ThemeToggle />}
          enabledServiceModes={enabledServiceModes}
        />
      )}
    </>
  );
}
