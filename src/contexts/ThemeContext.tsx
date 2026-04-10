import React, { createContext, useState, useCallback, useContext, useEffect } from 'react';

export interface ThemeContextType {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

// Cores padrão - Light Mode
const LIGHT_THEME = {
  'primary': '#FF6B35',
  'secondary': '#457B9D',
  'background': '#FFFFFF',
  'surface': '#F5F5F5',
  'text': '#1A1A1A',
  'text-secondary': '#666666',
  'accent': '#E63946',
  'border': '#E0E0E0',
  'success': '#4CAF50',
  'warning': '#FFC107',
  'error': '#F44336'
};

// Cores padrão - Dark Mode
const DARK_THEME = {
  'primary': '#FF6B35',
  'secondary': '#94A3B8',
  'background': '#141923',
  'surface': '#202632',
  'text': '#F1F5F9',
  'text-secondary': '#94A3B8',
  'accent': '#FB923C',
  'border': '#2E3746',
  'success': '#66BB6A',
  'warning': '#FDD835',
  'error': '#EF5350'
};

const DARK_MODE_KEY = 'kds:dark-mode';

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Aplica as variáveis CSS para o modo atual
 */
function applyThemeColors(isDarkMode: boolean) {
  if (typeof document === 'undefined') return;

  const colors = isDarkMode ? DARK_THEME : LIGHT_THEME;
  const root = document.documentElement;

  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(`--color-${key}`, value);
  });

  // Aplica a classe dark-mode no document
  if (isDarkMode) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  // Inicializa com a preferência salva ou detecta do sistema
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    
    const saved = localStorage.getItem(DARK_MODE_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
    
    // Detecta preferência do sistema
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Aplica o tema ao montar e quando mudar
  useEffect(() => {
    applyThemeColors(isDarkMode);
    localStorage.setItem(DARK_MODE_KEY, String(isDarkMode));
  }, [isDarkMode]);

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(prev => !prev);
  }, []);

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme deve ser usado dentro de ThemeProvider');
  }
  return context;
};
