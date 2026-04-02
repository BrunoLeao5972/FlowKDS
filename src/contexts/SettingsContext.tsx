import React, { createContext, useContext, useEffect, useState } from 'react';

type OrderNumberMode = 'continuous' | 'daily-reset' | 'custom-start';
type PrintSize = '58mm' | '80mm' | 'A4';

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
  printerName: string;
  printSize: PrintSize;
  printScale: number;
  // order numbering settings
  orderNumberMode: OrderNumberMode;
  customStartNumber: number;
  lastResetDate: string | null; // ISO date (YYYY-MM-DD)
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
  setPrinterName: (name: string) => void;
  setPrintSize: (size: PrintSize) => void;
  setPrintScale: (scale: number) => void;
  setOrderNumberMode: (m: OrderNumberMode) => void;
  setCustomStartNumber: (n: number) => void;
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
  newOrderSound: null,
  readyOrderSound: null,
  newOrderSoundEnabled: true,
  readyOrderSoundEnabled: true,
  printerName: '',
  printSize: '80mm',
  printScale: FIXED_PRINT_SCALE,
  orderNumberMode: 'continuous',
  customStartNumber: 100,
  lastResetDate: null,
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
  setPrinterName: () => {},
  setPrintSize: () => {},
  setPrintScale: () => {},
  setOrderNumberMode: () => {},
  setCustomStartNumber: () => {},
  animationsEnabled: true,
  setAnimationsEnabled: () => {},
  computeNextNumber: () => 101,
  touchResetDate: () => {},
};

const SettingsContext = createContext<Settings>(defaultValues);

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

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
  const [printerName, setPrinterName] = useState<string>(defaultValues.printerName);
  const [printSize, setPrintSize] = useState<PrintSize>(defaultValues.printSize);
  const [printScale, setPrintScale] = useState<number>(defaultValues.printScale);

  const [orderNumberMode, setOrderNumberMode] = useState<OrderNumberMode>(defaultValues.orderNumberMode);
  const [customStartNumber, setCustomStartNumber] = useState<number>(defaultValues.customStartNumber);
  const [lastResetDate, setLastResetDate] = useState<string | null>(defaultValues.lastResetDate);
  const [animationsEnabled, setAnimationsEnabled] = useState<boolean>(true);

  // persist/load
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
        if (parsed.newOrderSound) setNewOrderSound(parsed.newOrderSound);
        if (parsed.readyOrderSound) setReadyOrderSound(parsed.readyOrderSound);
        if (typeof parsed.newOrderSoundEnabled === 'boolean') setNewOrderSoundEnabled(parsed.newOrderSoundEnabled);
        if (typeof parsed.readyOrderSoundEnabled === 'boolean') setReadyOrderSoundEnabled(parsed.readyOrderSoundEnabled);
        if (typeof parsed.printerName === 'string') setPrinterName(parsed.printerName);
        if (parsed.printSize === '58mm' || parsed.printSize === '80mm' || parsed.printSize === 'A4') setPrintSize(parsed.printSize);
        setPrintScale(FIXED_PRINT_SCALE);
      }
    } catch (e) {
      // ignore
    }
  }, []);

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
        if (typeof data.tradeName === 'string') setRestaurantTradeName(data.tradeName);
        if (typeof data.legalName === 'string') setRestaurantLegalName(data.legalName);
        if (typeof data.cnpj === 'string') setRestaurantCnpj(data.cnpj);
        if (typeof data.cep === 'string') setRestaurantCep(data.cep);
        if (typeof data.street === 'string') setRestaurantStreet(data.street);
        if (typeof data.number === 'string') setRestaurantNumber(data.number);
        if (typeof data.city === 'string') setRestaurantCity(data.city);
        if (typeof data.complement === 'string') setRestaurantComplement(data.complement);
      } catch (error) {
        // ignore to keep app usable offline
      }
    };

    void loadRestaurantFromDatabase();
  }, []);

  useEffect(() => {
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
      newOrderSound,
      readyOrderSound,
      newOrderSoundEnabled,
      readyOrderSoundEnabled,
      printerName,
      printSize,
      printScale: FIXED_PRINT_SCALE,
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
    newOrderSound,
    readyOrderSound,
    newOrderSoundEnabled,
    readyOrderSoundEnabled,
    printerName,
    printSize,
    printScale,
  ]);

  const touchResetDate = (date?: Date) => {
    const d = date ? todayStr(date) : todayStr();
    setLastResetDate(d);
  };

  // Keep setters for sounds persisted
  const _setNewOrderSound = (s: string | null) => setNewOrderSound(s);
  const _setReadyOrderSound = (s: string | null) => setReadyOrderSound(s);
  const _setNewOrderSoundEnabled = (b: boolean) => setNewOrderSoundEnabled(b);
  const _setReadyOrderSoundEnabled = (b: boolean) => setReadyOrderSoundEnabled(b);

  const computeNextNumber = (orders: Array<{ number: number; createdAt?: string | number | Date }>) => {
    // determine base start
    const start = customStartNumber || 100;
    const isResetMode = orderNumberMode === 'daily-reset' || orderNumberMode === 'custom-start';
    // when in a reset mode, restrict to orders from the reset date (or today)
    let relevant = orders;
    if (isResetMode) {
      const dateStr = lastResetDate || todayStr();
      relevant = orders.filter(o => {
        if (!o.createdAt) return false;
        const d = new Date(o.createdAt);
        return todayStr(d) === dateStr;
      });
      // For custom-start we always start at the configured start number when reset date is today
      if (orderNumberMode === 'custom-start') {
        const today = todayStr();
        if (lastResetDate === today || !lastResetDate) return start;
      }
      if (relevant.length === 0) return start;
    }

    const max = relevant.length === 0 ? start - 1 : Math.max(...relevant.map(o => Number(o.number || 0)));
    const next = max + 1;
    // ensure next is at least start when custom-start or daily-reset
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
        setPrinterName,
        setPrintSize,
        setPrintScale: () => setPrintScale(FIXED_PRINT_SCALE),
        orderNumberMode,
        customStartNumber,
        lastResetDate,
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
        animationsEnabled,
        setAnimationsEnabled,
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
