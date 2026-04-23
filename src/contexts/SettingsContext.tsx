import React, { createContext, useContext, useEffect, useState } from 'react';

type OrderNumberMode = 'continuous' | 'daily-reset' | 'custom-start';
type PrintSize = '58mm' | '80mm' | 'A4';
export type ServiceMode = 'balcao' | 'mesa' | 'cartao' | 'delivery' | 'encomenda' | 'servico' | 'apartamento';

const ALL_SERVICE_MODES: ServiceMode[] = ['balcao', 'mesa', 'cartao', 'delivery', 'encomenda', 'servico', 'apartamento'];

type Settings = {
  tempoMedio: number;
  tempoAlerta: number;
  tempoCritico: number;
  restaurantTradeName: string;
  restaurantLegalName: string;
  restaurantCnpj: string;
  restaurantCep: string;
  restaurantStreet: string;
  restaurantNumber: string;
  restaurantCity: string;
  restaurantComplement: string;
  licenseFileName: string | null;
  licenseContent: string | null;
  // sound settings (data URLs or absolute paths)
  newOrderSound: string | null;
  readyOrderSound: string | null;
  newOrderSoundEnabled: boolean;
  readyOrderSoundEnabled: boolean;
  // panel call sound (plays on /display when an order becomes ready)
  panelCallSound: string | null;
  panelCallSoundEnabled: boolean;
  printerName: string;
  printSize: PrintSize;
  printScale: number;
  // order numbering settings
  orderNumberMode: OrderNumberMode;
  customStartNumber: number;
  lastResetDate: string | null; // ISO date (YYYY-MM-DD)
  enabledServiceModes: ServiceMode[];
  panelEnabledServiceModes: ServiceMode[];
  // automatic preparation: when enabled, new orders automatically transition to 'preparing' status
  autoPrep: boolean;
  setAutoPrep: (v: boolean) => void;
  setTempoMedio: (v: number) => void;
  setTempoAlerta: (v: number) => void;
  setTempoCritico: (v: number) => void;
  setRestaurantTradeName: (v: string) => void;
  setRestaurantLegalName: (v: string) => void;
  setRestaurantCnpj: (v: string) => void;
  setRestaurantCep: (v: string) => void;
  setRestaurantStreet: (v: string) => void;
  setRestaurantNumber: (v: string) => void;
  setRestaurantCity: (v: string) => void;
  setRestaurantComplement: (v: string) => void;
  setLicenseFileName: (v: string | null) => void;
  setLicenseContent: (v: string | null) => void;
  setNewOrderSound: (s: string | null) => void;
  setReadyOrderSound: (s: string | null) => void;
  setNewOrderSoundEnabled: (b: boolean) => void;
  setReadyOrderSoundEnabled: (b: boolean) => void;
  setPanelCallSound: (s: string | null) => void;
  setPanelCallSoundEnabled: (b: boolean) => void;
  setPrinterName: (name: string) => void;
  setPrintSize: (size: PrintSize) => void;
  setPrintScale: (scale: number) => void;
  setOrderNumberMode: (m: OrderNumberMode) => void;
  setCustomStartNumber: (n: number) => void;
  setEnabledServiceModes: (modes: ServiceMode[]) => void;
  setPanelEnabledServiceModes: (modes: ServiceMode[]) => void;
  // panel color settings
  panelColor: string;
  setPanelColor: (color: string) => void;
  // kitchen animations toggle
  animationsEnabled: boolean;
  setAnimationsEnabled: (v: boolean) => void;
  // helper: compute next order number given current orders
  computeNextNumber: (orders: Array<{ number: number; createdAt?: string | number | Date }>) => number;
  // allow manual reset (updates lastResetDate)
  touchResetDate: (date?: Date) => void;
};

const STORAGE_KEY = 'kds:settings:v1';
const FIXED_PRINT_SCALE = 115;
const DEFAULT_NEW_ORDER_SOUND = '/Songs/Efeito Sonoro - Chegou Pedido.mp3';
const DEFAULT_READY_ORDER_SOUND = '/Songs/Efeito Sonoro - Pedido Pronto.mp3';
const DEFAULT_PANEL_CALL_SOUND = '/Songs/Efeito Sonoro - Painel de Retirada.mp3';

function normalizeSoundSource(value: unknown, fallback: string): string {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  // Migra caminho legado que nao existe mais no pacote atual.
  if (raw === '/Songs/Efeito Sonoro - Chegou.mp3') {
    return DEFAULT_NEW_ORDER_SOUND;
  }

  return raw;
}

const defaultValues: Settings = {
  tempoMedio: 15,
  tempoAlerta: 20,
  tempoCritico: 25,
  restaurantTradeName: '',
  restaurantLegalName: '',
  restaurantCnpj: '',
  restaurantCep: '',
  restaurantStreet: '',
  restaurantNumber: '',
  restaurantCity: '',
  restaurantComplement: '',
  licenseFileName: null,
  licenseContent: null,
  newOrderSound: DEFAULT_NEW_ORDER_SOUND,
  readyOrderSound: DEFAULT_READY_ORDER_SOUND,
  newOrderSoundEnabled: true,
  readyOrderSoundEnabled: true,
  panelCallSound: DEFAULT_PANEL_CALL_SOUND,
  panelCallSoundEnabled: true,
  printerName: '',
  printSize: '80mm',
  printScale: FIXED_PRINT_SCALE,
  orderNumberMode: 'continuous',
  customStartNumber: 100,
  lastResetDate: null,
  enabledServiceModes: [...ALL_SERVICE_MODES],
  panelEnabledServiceModes: ['balcao', 'delivery', 'encomenda'],
  setTempoMedio: () => {},
  setTempoAlerta: () => {},
  setTempoCritico: () => {},
  setRestaurantTradeName: () => {},
  setRestaurantLegalName: () => {},
  setRestaurantCnpj: () => {},
  setRestaurantCep: () => {},
  setRestaurantStreet: () => {},
  setRestaurantNumber: () => {},
  setRestaurantCity: () => {},
  setRestaurantComplement: () => {},
  setLicenseFileName: () => {},
  setLicenseContent: () => {},
  setNewOrderSound: () => {},
  setReadyOrderSound: () => {},
  setNewOrderSoundEnabled: () => {},
  setReadyOrderSoundEnabled: () => {},
  setPanelCallSound: () => {},
  setPanelCallSoundEnabled: () => {},
  setPrinterName: () => {},
  setPrintSize: () => {},
  setPrintScale: () => {},
  setOrderNumberMode: () => {},
  setCustomStartNumber: () => {},
  setEnabledServiceModes: () => {},
  setPanelEnabledServiceModes: () => {},
  panelColor: '#FF6B35',
  setPanelColor: () => {},
  animationsEnabled: true,
  setAnimationsEnabled: () => {},
  autoPrep: false,
  setAutoPrep: () => {},
  computeNextNumber: () => 101,
  touchResetDate: () => {},
};

const SettingsContext = createContext<Settings>(defaultValues);

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// Em desenvolvimento o frontend roda separado da API; em produção usa mesma origem.
function getApiBase() {
  if (window.location.port === '5173') {
    return `${window.location.protocol}//${window.location.hostname}:8081`;
  }
  return window.location.origin;
}

export const SettingsProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const [tempoMedio, setTempoMedio] = useState<number>(defaultValues.tempoMedio);
  const [tempoAlerta, setTempoAlerta] = useState<number>(defaultValues.tempoAlerta);
  const [tempoCritico, setTempoCritico] = useState<number>(defaultValues.tempoCritico);
  const [restaurantTradeName, setRestaurantTradeName] = useState<string>(defaultValues.restaurantTradeName);
  const [restaurantLegalName, setRestaurantLegalName] = useState<string>(defaultValues.restaurantLegalName);
  const [restaurantCnpj, setRestaurantCnpj] = useState<string>(defaultValues.restaurantCnpj);
  const [restaurantCep, setRestaurantCep] = useState<string>(defaultValues.restaurantCep);
  const [restaurantStreet, setRestaurantStreet] = useState<string>(defaultValues.restaurantStreet);
  const [restaurantNumber, setRestaurantNumber] = useState<string>(defaultValues.restaurantNumber);
  const [restaurantCity, setRestaurantCity] = useState<string>(defaultValues.restaurantCity);
  const [restaurantComplement, setRestaurantComplement] = useState<string>(defaultValues.restaurantComplement);
  const [licenseFileName, setLicenseFileName] = useState<string | null>(defaultValues.licenseFileName);
  const [licenseContent, setLicenseContent] = useState<string | null>(defaultValues.licenseContent);

  const [newOrderSound, setNewOrderSound] = useState<string | null>(defaultValues.newOrderSound);
  const [readyOrderSound, setReadyOrderSound] = useState<string | null>(defaultValues.readyOrderSound);
  const [newOrderSoundEnabled, setNewOrderSoundEnabled] = useState<boolean>(defaultValues.newOrderSoundEnabled);
  const [readyOrderSoundEnabled, setReadyOrderSoundEnabled] = useState<boolean>(defaultValues.readyOrderSoundEnabled);
  const [panelCallSound, setPanelCallSound] = useState<string | null>(defaultValues.panelCallSound);
  const [panelCallSoundEnabled, setPanelCallSoundEnabled] = useState<boolean>(defaultValues.panelCallSoundEnabled);
  const [printerName, setPrinterName] = useState<string>(defaultValues.printerName);
  const [printSize, setPrintSize] = useState<PrintSize>(defaultValues.printSize);
  const [printScale, setPrintScale] = useState<number>(defaultValues.printScale);

  const [orderNumberMode, setOrderNumberMode] = useState<OrderNumberMode>(defaultValues.orderNumberMode);
  const [customStartNumber, setCustomStartNumber] = useState<number>(defaultValues.customStartNumber);
  const [lastResetDate, setLastResetDate] = useState<string | null>(defaultValues.lastResetDate);
  const [enabledServiceModes, setEnabledServiceModes] = useState<ServiceMode[]>(defaultValues.enabledServiceModes);
  const [panelEnabledServiceModes, setPanelEnabledServiceModes] = useState<ServiceMode[]>(defaultValues.panelEnabledServiceModes);
  const [panelColor, setPanelColor] = useState<string>(defaultValues.panelColor);
  const [animationsEnabled, setAnimationsEnabled] = useState<boolean>(true);
  const [autoPrep, setAutoPrep] = useState<boolean>(false);

  // Carrega preferências locais e faz migração leve de campos legados.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.tempoMedio) setTempoMedio(parsed.tempoMedio);
        if (parsed.tempoAlerta) setTempoAlerta(parsed.tempoAlerta);
        if (parsed.tempoCritico) setTempoCritico(parsed.tempoCritico);
        if (typeof parsed.restaurantTradeName === 'string') setRestaurantTradeName(parsed.restaurantTradeName);
        if (typeof parsed.restaurantLegalName === 'string') setRestaurantLegalName(parsed.restaurantLegalName);
        if (typeof parsed.restaurantCnpj === 'string') setRestaurantCnpj(parsed.restaurantCnpj);
        if (typeof parsed.restaurantCep === 'string') setRestaurantCep(parsed.restaurantCep);
        if (typeof parsed.restaurantStreet === 'string') setRestaurantStreet(parsed.restaurantStreet);
        if (typeof parsed.restaurantNumber === 'string') setRestaurantNumber(parsed.restaurantNumber);
        if (typeof parsed.restaurantCity === 'string') setRestaurantCity(parsed.restaurantCity);
        if (typeof parsed.restaurantComplement === 'string') setRestaurantComplement(parsed.restaurantComplement);
        if (
          typeof parsed.restaurantAddress === 'string' &&
          !parsed.restaurantStreet &&
          !parsed.restaurantNumber &&
          !parsed.restaurantCity
        ) {
          setRestaurantStreet(parsed.restaurantAddress);
        }
        if (typeof parsed.licenseFileName === 'string' || parsed.licenseFileName === null) setLicenseFileName(parsed.licenseFileName ?? null);
        if (typeof parsed.licenseContent === 'string' || parsed.licenseContent === null) setLicenseContent(parsed.licenseContent ?? null);
        if (parsed.orderNumberMode) setOrderNumberMode(parsed.orderNumberMode);
        if (typeof parsed.customStartNumber === 'number') setCustomStartNumber(parsed.customStartNumber);
        if (parsed.lastResetDate) setLastResetDate(parsed.lastResetDate);
        if (Array.isArray(parsed.enabledServiceModes)) {
          const normalizedModes = parsed.enabledServiceModes
            .map((mode: unknown) => String(mode || '').trim().toLowerCase())
            .filter((mode: string): mode is ServiceMode => ALL_SERVICE_MODES.includes(mode as ServiceMode));
          setEnabledServiceModes(normalizedModes.length ? [...new Set(normalizedModes)] : [...ALL_SERVICE_MODES]);
        }
        if (Array.isArray(parsed.panelEnabledServiceModes)) {
          const normalizedPanelModes = parsed.panelEnabledServiceModes
            .map((mode: unknown) => String(mode || '').trim().toLowerCase())
            .filter((mode: string): mode is ServiceMode => ALL_SERVICE_MODES.includes(mode as ServiceMode));
          setPanelEnabledServiceModes(normalizedPanelModes.length ? [...new Set(normalizedPanelModes)] : [...defaultValues.panelEnabledServiceModes]);
        }
        if (Object.prototype.hasOwnProperty.call(parsed, 'newOrderSound')) {
          setNewOrderSound(normalizeSoundSource(parsed.newOrderSound, DEFAULT_NEW_ORDER_SOUND));
        }
        if (Object.prototype.hasOwnProperty.call(parsed, 'readyOrderSound')) {
          setReadyOrderSound(normalizeSoundSource(parsed.readyOrderSound, DEFAULT_READY_ORDER_SOUND));
        }
        if (typeof parsed.newOrderSoundEnabled === 'boolean') setNewOrderSoundEnabled(parsed.newOrderSoundEnabled);
        if (typeof parsed.readyOrderSoundEnabled === 'boolean') setReadyOrderSoundEnabled(parsed.readyOrderSoundEnabled);
        if (Object.prototype.hasOwnProperty.call(parsed, 'panelCallSound')) {
          setPanelCallSound(normalizeSoundSource(parsed.panelCallSound, DEFAULT_PANEL_CALL_SOUND));
        }
        if (typeof parsed.panelCallSoundEnabled === 'boolean') setPanelCallSoundEnabled(parsed.panelCallSoundEnabled);
        if (typeof parsed.printerName === 'string') setPrinterName(parsed.printerName);
        if (parsed.printSize === '58mm' || parsed.printSize === '80mm' || parsed.printSize === 'A4') setPrintSize(parsed.printSize);
        if (typeof parsed.panelColor === 'string') setPanelColor(parsed.panelColor);
        if (typeof parsed.autoPrep === 'boolean') setAutoPrep(parsed.autoPrep);
        setPrintScale(FIXED_PRINT_SCALE);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  // Busca dados cadastrais do restaurante no backend quando disponível.
  useEffect(() => {
    const loadRestaurantFromDatabase = async () => {
      try {
        const token = localStorage.getItem('kds_auth_token') || '';
        const response = await fetch(`${getApiBase()}/settings/restaurant`, {
          method: 'GET',
          headers: {
            ...(token ? { 'x-kds-token': token } : {}),
          },
        });
        if (!response.ok) return;

        const data = await response.json();
        if (typeof data.tempoMedio === 'number') setTempoMedio(data.tempoMedio);
        if (typeof data.tempoAlerta === 'number') setTempoAlerta(data.tempoAlerta);
        if (typeof data.tempoCritico === 'number') setTempoCritico(data.tempoCritico);
        if (typeof data.tradeName === 'string') setRestaurantTradeName(data.tradeName);
        if (typeof data.legalName === 'string') setRestaurantLegalName(data.legalName);
        if (typeof data.cnpj === 'string') setRestaurantCnpj(data.cnpj);
        if (typeof data.cep === 'string') setRestaurantCep(data.cep);
        if (typeof data.street === 'string') setRestaurantStreet(data.street);
        if (typeof data.number === 'string') setRestaurantNumber(data.number);
        if (typeof data.city === 'string') setRestaurantCity(data.city);
        if (typeof data.complement === 'string') setRestaurantComplement(data.complement);
        if (data.orderNumberMode === 'continuous' || data.orderNumberMode === 'daily-reset' || data.orderNumberMode === 'custom-start') {
          setOrderNumberMode(data.orderNumberMode);
        }
        if (typeof data.customStartNumber === 'number') setCustomStartNumber(data.customStartNumber);
        if (typeof data.lastResetDate === 'string' || data.lastResetDate === null) setLastResetDate(data.lastResetDate ?? null);
        if (typeof data.licenseFileName === 'string' || data.licenseFileName === null) setLicenseFileName(data.licenseFileName ?? null);
        if (typeof data.licenseContent === 'string' || data.licenseContent === null) setLicenseContent(data.licenseContent ?? null);
        if (typeof data.newOrderSound === 'string' || data.newOrderSound === null) {
          setNewOrderSound(normalizeSoundSource(data.newOrderSound, DEFAULT_NEW_ORDER_SOUND));
        }
        if (typeof data.readyOrderSound === 'string' || data.readyOrderSound === null) {
          setReadyOrderSound(normalizeSoundSource(data.readyOrderSound, DEFAULT_READY_ORDER_SOUND));
        }
        if (typeof data.newOrderSoundEnabled === 'boolean') setNewOrderSoundEnabled(data.newOrderSoundEnabled);
        if (typeof data.readyOrderSoundEnabled === 'boolean') setReadyOrderSoundEnabled(data.readyOrderSoundEnabled);
        if (typeof data.panelCallSound === 'string' || data.panelCallSound === null) {
          setPanelCallSound(normalizeSoundSource(data.panelCallSound, DEFAULT_PANEL_CALL_SOUND));
        }
        if (typeof data.panelCallSoundEnabled === 'boolean') setPanelCallSoundEnabled(data.panelCallSoundEnabled);
        if (typeof data.printerName === 'string') setPrinterName(data.printerName);
        if (data.printSize === '58mm' || data.printSize === '80mm' || data.printSize === 'A4') setPrintSize(data.printSize);
        if (typeof data.printScale === 'number' && Number.isFinite(data.printScale)) setPrintScale(data.printScale);
        if (typeof data.panelColor === 'string') setPanelColor(data.panelColor);
        if (typeof data.animationsEnabled === 'boolean') setAnimationsEnabled(data.animationsEnabled);
        if (typeof data.autoPrep === 'boolean') setAutoPrep(data.autoPrep);
        if (Array.isArray(data.enabledServiceModes)) {
          const normalizedModes = data.enabledServiceModes
            .map((mode: unknown) => String(mode || '').trim().toLowerCase())
            .filter((mode: string): mode is ServiceMode => ALL_SERVICE_MODES.includes(mode as ServiceMode));
          setEnabledServiceModes(normalizedModes.length ? [...new Set(normalizedModes)] : [...ALL_SERVICE_MODES]);
        }
        if (Array.isArray(data.panelEnabledServiceModes)) {
          const normalizedPanelModes = data.panelEnabledServiceModes
            .map((mode: unknown) => String(mode || '').trim().toLowerCase())
            .filter((mode: string): mode is ServiceMode => ALL_SERVICE_MODES.includes(mode as ServiceMode));
          setPanelEnabledServiceModes(normalizedPanelModes.length ? [...new Set(normalizedPanelModes)] : [...defaultValues.panelEnabledServiceModes]);
        }
      } catch (error) {
        // ignore to keep app usable offline
      }
    };

    void loadRestaurantFromDatabase();
  }, []);

  useEffect(() => {
    // Salva continuamente preferências operacionais para uso offline-first.
    const toSave = {
      tempoMedio,
      tempoAlerta,
      tempoCritico,
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
      orderNumberMode,
      customStartNumber,
      lastResetDate,
      enabledServiceModes,
      panelEnabledServiceModes,
      newOrderSound,
      readyOrderSound,
      newOrderSoundEnabled,
      readyOrderSoundEnabled,
      panelCallSound,
      panelCallSoundEnabled,
      printerName,
      printSize,
      printScale: FIXED_PRINT_SCALE,
      panelColor,
      autoPrep,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {}
  }, [
    tempoMedio,
    tempoAlerta,
    tempoCritico,
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
    orderNumberMode,
    customStartNumber,
    lastResetDate,
    enabledServiceModes,
    panelEnabledServiceModes,
    newOrderSound,
    readyOrderSound,
    newOrderSoundEnabled,
    readyOrderSoundEnabled,
    panelCallSound,
    panelCallSoundEnabled,
    printerName,
    printSize,
    printScale,
    panelColor,
    autoPrep,
  ]);

  const touchResetDate = (date?: Date) => {
    const d = date ? todayStr(date) : todayStr();
    setLastResetDate(d);
  };

  // Wrappers mantêm a API de contexto explícita para configurações de áudio.
  const _setNewOrderSound = (s: string | null) => setNewOrderSound(s);
  const _setReadyOrderSound = (s: string | null) => setReadyOrderSound(s);
  const _setNewOrderSoundEnabled = (b: boolean) => setNewOrderSoundEnabled(b);
  const _setReadyOrderSoundEnabled = (b: boolean) => setReadyOrderSoundEnabled(b);
  const _setPanelCallSound = (s: string | null) => setPanelCallSound(s);
  const _setPanelCallSoundEnabled = (b: boolean) => setPanelCallSoundEnabled(b);

  const computeNextNumber = (orders: Array<{ number: number; createdAt?: string | number | Date }>) => {
    // Define base inicial conforme modo configurado.
    const start = customStartNumber || 100;
    const isResetMode = orderNumberMode === 'daily-reset' || orderNumberMode === 'custom-start';
    // Em modos com reset, considera apenas pedidos da data de referência.
    let relevant = orders;
    if (isResetMode) {
      const dateStr = lastResetDate || todayStr();
      relevant = orders.filter(o => {
        if (!o.createdAt) return false;
        const d = new Date(o.createdAt);
        return todayStr(d) === dateStr;
      });
      // No custom-start, o primeiro pedido do dia inicia no valor configurado.
      if (orderNumberMode === 'custom-start') {
        const today = todayStr();
        if (lastResetDate === today || !lastResetDate) return start;
      }
      if (relevant.length === 0) return start;
    }

    const max = relevant.length === 0 ? start - 1 : Math.max(...relevant.map(o => Number(o.number || 0)));
    const next = max + 1;
    // Garante piso mínimo para evitar regressão de numeração.
    return Math.max(next, start);
  };

  return (
    <SettingsContext.Provider
      value={{
        tempoMedio,
        tempoAlerta,
        tempoCritico,
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
        newOrderSoundEnabled,
        readyOrderSoundEnabled,
        printerName,
        printSize,
        printScale: FIXED_PRINT_SCALE,
        setNewOrderSound: _setNewOrderSound,
        setReadyOrderSound: _setReadyOrderSound,
        setNewOrderSoundEnabled: _setNewOrderSoundEnabled,
        setReadyOrderSoundEnabled: _setReadyOrderSoundEnabled,
        panelCallSound,
        panelCallSoundEnabled,
        setPanelCallSound: _setPanelCallSound,
        setPanelCallSoundEnabled: _setPanelCallSoundEnabled,
        setPrinterName,
        setPrintSize,
        setPrintScale: () => setPrintScale(FIXED_PRINT_SCALE),
        orderNumberMode,
        customStartNumber,
        lastResetDate,
        enabledServiceModes,
        panelEnabledServiceModes,
        setTempoMedio,
        setTempoAlerta,
        setTempoCritico,
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
        setOrderNumberMode,
        setCustomStartNumber,
        setEnabledServiceModes,
        setPanelEnabledServiceModes,
        panelColor,
        setPanelColor,
        animationsEnabled,
        setAnimationsEnabled,
        autoPrep,
        setAutoPrep,
        computeNextNumber,
        touchResetDate,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export function useSettings() {
  return useContext(SettingsContext);
}

export default SettingsContext;
