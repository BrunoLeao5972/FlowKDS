import React, { createContext, useState, useCallback, useContext, useEffect } from 'react';

export interface Theme {
  id?: string;
  name: string;
  isActive: boolean;
  colors: {
    primary: { hex: string };
    secondary: { hex: string };
    background: { hex: string };
    surface: { hex: string };
    text: { hex: string };
    textSecondary: { hex: string };
    accent: { hex: string };
    border: { hex: string };
    success: { hex: string };
    warning: { hex: string };
    error: { hex: string };
  };
  description?: string;
  contrastMetrics?: {
    primaryVsBackground: number;
    textVsBackground: number;
    textVsSurface: number;
    wcagAACompliant: boolean;
    wcagAAACompliant: boolean;
  };
}

export interface ThemeContextType {
  theme: Theme | null;
  loading: boolean;
  error: string | null;
  savedThemes: Theme[];
  
  loadTheme: (themeId?: string) => Promise<void>;
  updateTheme: (colors: Theme['colors']) => Promise<void>;
  saveTheme: (name: string, description?: string) => Promise<void>;
  listThemes: () => Promise<void>;
  applyTheme: (theme: Theme) => void;
  resetToDefault: () => void;
  
  getColorVariable: (key: keyof Theme['colors']) => string;
  getAllColorVariables: () => Record<string, string>;
}

const DEFAULT_THEME: Theme = {
  name: 'Padrão',
  isActive: true,
  colors: {
    primary: { hex: '#FF6B35' },
    secondary: { hex: '#457B9D' },
    background: { hex: '#FFFFFF' },
    surface: { hex: '#F5F5F5' },
    text: { hex: '#1A1A1A' },
    textSecondary: { hex: '#666666' },
    accent: { hex: '#E63946' },
    border: { hex: '#E0E0E0' },
    success: { hex: '#4CAF50' },
    warning: { hex: '#FFC107' },
    error: { hex: '#F44336' }
  }
};

const STORAGE_KEY = 'kds:theme:v1';

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedThemes, setSavedThemes] = useState<Theme[]>([]);

  const getApiBase = () => {
    if (typeof window === 'undefined') return '';
    if (window.location.port === '5173') {
      return `${window.location.protocol}//${window.location.hostname}:8081`;
    }
    return window.location.origin;
  };

  /**
   * Carrega tema ativo do servidor
   */
  const loadTheme = useCallback(async (themeId?: string) => {
    try {
      setLoading(true);
      setError(null);

      const endpoint = themeId ? `/saas/themes/${themeId}` : '/saas/themes/active';
      const response = await fetch(`${getApiBase()}${endpoint}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`Erro ${response.status}`);
      }

      const data = await response.json();
      const loadedTheme = data.theme || data;

      setTheme(loadedTheme);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loadedTheme));
      applyThemeVariables(loadedTheme);
    } catch (err) {
      console.error('Erro ao carregar tema:', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar tema');
      
      // Fallback para localStorage ou padrão
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        try {
          const cachedTheme = JSON.parse(cached);
          setTheme(cachedTheme);
          applyThemeVariables(cachedTheme);
        } catch (e) {
          setTheme(DEFAULT_THEME);
          applyThemeVariables(DEFAULT_THEME);
        }
      } else {
        setTheme(DEFAULT_THEME);
        applyThemeVariables(DEFAULT_THEME);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Atualiza cores de um tema existente
   */
  const updateTheme = useCallback(async (colors: Theme['colors']) => {
    if (!theme?.id) {
      setError('Tema sem ID');
      return;
    }

    try {
      setError(null);
      const response = await fetch(`${getApiBase()}/saas/themes/${theme.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
        },
        body: JSON.stringify({ colors })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(errorData.details?.join('; ') || errorData.error || `Erro ${response.status}`);
      }

      const data = await response.json();
      const updatedTheme = data.theme || data;

      setTheme(updatedTheme);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedTheme));
      applyThemeVariables(updatedTheme);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar cores';
      console.error(msg, err);
      setError(msg);
    }
  }, [theme]);

  /**
   * Salva novo tema com nome
   */
  const saveTheme = useCallback(async (name: string, description?: string) => {
    if (!theme?.colors) {
      setError('Nenhum tema para salvar');
      return;
    }

    try {
      setError(null);
      const response = await fetch(`${getApiBase()}/saas/themes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
        },
        body: JSON.stringify({
          name: name || 'Novo Tema',
          description,
          colors: theme.colors,
          isActive: true
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(errorData.details?.join('; ') || errorData.error || `Erro ${response.status}`);
      }

      const data = await response.json();
      const savedTheme = data.theme || data;

      setTheme(savedTheme);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedTheme));
      
      // Carrega lista após salvar
      await listThemes();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar tema';
      console.error(msg, err);
      setError(msg);
    }
  }, [theme]);

  /**
   * Lista temas salvos
   */
  const listThemes = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`${getApiBase()}/saas/themes?limit=50`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
        }
      });

      if (!response.ok) {
        throw new Error(`Erro ${response.status}`);
      }

      const data = await response.json();
      setSavedThemes(data.themes || []);
    } catch (err) {
      console.error('Erro ao listar temas:', err);
    }
  }, []);

  const applyTheme = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newTheme));
    applyThemeVariables(newTheme);
  }, []);

  const resetToDefault = useCallback(() => {
    setTheme(DEFAULT_THEME);
    localStorage.removeItem(STORAGE_KEY);
    applyThemeVariables(DEFAULT_THEME);
  }, []);

  const getColorVariable = useCallback((key: keyof Theme['colors']) => {
    if (!theme) return DEFAULT_THEME.colors[key].hex;
    return theme.colors[key]?.hex || DEFAULT_THEME.colors[key].hex;
  }, [theme]);

  const getAllColorVariables = useCallback(() => {
    const colors = theme?.colors || DEFAULT_THEME.colors;
    return {
      '--color-primary': colors.primary.hex,
      '--color-secondary': colors.secondary.hex,
      '--color-background': colors.background.hex,
      '--color-surface': colors.surface.hex,
      '--color-text': colors.text.hex,
      '--color-text-secondary': colors.textSecondary.hex,
      '--color-accent': colors.accent.hex,
      '--color-border': colors.border.hex,
      '--color-success': colors.success.hex,
      '--color-warning': colors.warning.hex,
      '--color-error': colors.error.hex,
    };
  }, [theme]);

  // Carrega tema ao montar
  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  const value: ThemeContextType = {
    theme: theme || DEFAULT_THEME,
    loading,
    error,
    savedThemes,
    loadTheme,
    updateTheme,
    saveTheme,
    listThemes,
    applyTheme,
    resetToDefault,
    getColorVariable,
    getAllColorVariables
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme deve ser usado dentro de <ThemeProvider>');
  }
  return context;
};

function applyThemeVariables(theme: Theme) {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root) return;

  const colors = theme.colors;
  root.style.setProperty('--color-primary', colors.primary.hex);
  root.style.setProperty('--color-secondary', colors.secondary.hex);
  root.style.setProperty('--color-background', colors.background.hex);
  root.style.setProperty('--color-surface', colors.surface.hex);
  root.style.setProperty('--color-text', colors.text.hex);
  root.style.setProperty('--color-text-secondary', colors.textSecondary.hex);
  root.style.setProperty('--color-accent', colors.accent.hex);
  root.style.setProperty('--color-border', colors.border.hex);
  root.style.setProperty('--color-success', colors.success.hex);
  root.style.setProperty('--color-warning', colors.warning.hex);
  root.style.setProperty('--color-error', colors.error.hex);
}
