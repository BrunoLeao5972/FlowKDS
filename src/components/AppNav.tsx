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
    lastResetDate,
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
    setPanelCallSound,
    setPanelCallSoundEnabled,
    setPrinterName,
    setPrintSize,
    setPrintScale,
    enabledServiceModes,
    setEnabledServiceModes,
    panelEnabledServiceModes,
    setPanelEnabledServiceModes,
    panelColor,
    setPanelColor,
    autoPrep,
    setAutoPrep,
  } = useSettings();

  const getApiBase = () => {
    if (window.location.port === '5173') {
      return `${window.location.protocol}//${window.location.hostname}:8081`;
    }
    return window.location.origin;
  };

  const saveRestaurantSettings = async (payload: {
    tempoMedio: number;
    tempoAlerta: number;
    tempoCritico: number;
    tradeName: string;
    legalName: string;
    cnpj: string;
    cep: string;
    street: string;
    number: string;
    city: string;
    complement: string;
    orderNumberMode: 'continuous' | 'daily-reset' | 'custom-start';
    customStartNumber: number;
    lastResetDate: string | null;
    licenseFileName: string | null;
    licenseContent: string | null;
    newOrderSound: string | null;
    readyOrderSound: string | null;
    newOrderSoundEnabled: boolean;
    readyOrderSoundEnabled: boolean;
    panelCallSound: string | null;
    panelCallSoundEnabled: boolean;
    printerName: string;
    printSize: '58mm' | '80mm' | 'A4';
    printScale: number;
    enabledServiceModes: string[];
    panelEnabledServiceModes: string[];
    panelColor: string;
    animationsEnabled: boolean;
    autoPrep: boolean;
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
        <div className="flex items-center gap-1 px-3 sm:px-4 h-14">
          <div className="flex min-w-0 items-center gap-2 mr-2 sm:mr-4">
            <img 
              src="/FOX KDS.png" 
              alt="FOX KDS" 
              className="h-8 w-auto object-contain"
            />
            <span className="truncate font-black text-base sm:text-lg text-primary">FOX KDS</span>
          </div>
          {links.filter(link => hasPermission(link.permission)).map(link => (
            <Link
              key={link.to}
              to={link.to}
              title={link.label}
              className={cn(
                'flex items-center gap-2 px-2 sm:px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname === link.to
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              <link.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{link.label}</span>
            </Link>
          ))}
          {hasPermission('settings') && (
            <button
              className="ml-2 inline-flex items-center gap-2 px-2 sm:px-3 py-2 rounded-lg text-sm font-medium bg-secondary hover:bg-orange-500 hover:text-white transition-colors"
              onClick={() => setShowConfig(true)}
              title="Configurações"
              type="button"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden md:inline">Configurações</span>
            </button>
          )}
          <div className="ml-auto" />
          <span className="text-sm text-muted-foreground ml-3 hidden sm:inline">{displayUsername}</span>
          <button
            className="ml-2 inline-flex items-center gap-2 px-2 sm:px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            onClick={logout}
            type="button"
            title="Sair"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden md:inline">Sair</span>
          </button>
        </div>
      </nav>

      {showConfig && (
        <ConfigDialog
          tempoMedio={tempoMedio}
          tempoCritico={tempoCritico}
          tempoAlerta={tempoAlerta}
          panelColor={panelColor}
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
            serviceModes,
            panelServiceModes,
            panelColorParam,
            panelCallSound,
            panelCallEnabled,
            autoPrep
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
              tempoMedio: medio,
              tempoAlerta: alerta,
              tempoCritico: critico,
              tradeName: restaurantTradeName,
              legalName: restaurantLegalName,
              cnpj: restaurantCnpj,
              cep: restaurantCep,
              street: restaurantStreet,
              number: restaurantNumber,
              city: restaurantCity,
              complement: restaurantComplement,
              orderNumberMode: orderMode,
              customStartNumber: startNumber,
              lastResetDate: (orderMode === 'daily-reset' || orderMode === 'custom-start')
                ? new Date().toISOString().slice(0, 10)
                : lastResetDate,
              licenseFileName,
              licenseContent,
              newOrderSound,
              readyOrderSound,
              newOrderSoundEnabled: !!newOrderEnabled,
              readyOrderSoundEnabled: !!readyEnabled,
              panelCallSound,
              panelCallSoundEnabled: !!panelCallEnabled,
              printerName,
              printSize,
              printScale,
              enabledServiceModes: serviceModes,
              panelEnabledServiceModes: panelServiceModes,
              panelColor: panelColorParam,
              animationsEnabled: true,
              autoPrep,
            });
            setLicenseFileName(licenseFileName);
            setLicenseContent(licenseContent);
            // persist sound settings
            setNewOrderSound(newOrderSound);
            setReadyOrderSound(readyOrderSound);
            setNewOrderSoundEnabled(!!newOrderEnabled);
            setReadyOrderSoundEnabled(!!readyEnabled);
            setPanelCallSound(panelCallSound);
            setPanelCallSoundEnabled(!!panelCallEnabled);
            setPrinterName(printerName);
            setPrintSize(printSize);
            setPrintScale(115);
            setEnabledServiceModes(serviceModes);
            setPanelEnabledServiceModes(panelServiceModes);
            setPanelColor(panelColorParam);
            setAutoPrep(autoPrep);
            // if user enabled daily-reset or custom-start, update last reset date to today so numbering starts immediately
            if (orderMode === 'daily-reset' || orderMode === 'custom-start') touchResetDate();
            setShowConfig(false);
          }}
          ThemeToggle={<ThemeToggle />}
          enabledServiceModes={enabledServiceModes}
          panelEnabledServiceModes={panelEnabledServiceModes}
          autoPrep={autoPrep}
        />
      )}
    </>
  );
}
