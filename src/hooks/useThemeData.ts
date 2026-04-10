/**
 * useThemeData.ts - Hook customizado para acesso simplificado às variáveis de tema
 * 
 * Sem interface adicional, apenas provide valores diretos do contexto
 * para uso em componentes
 */

import { useTheme } from '../contexts/ThemeContext';

export const useThemeData = () => {
  const themeContext = useTheme();
  
  return {
    // Estado
    theme: themeContext.theme,
    loading: themeContext.loading,
    error: themeContext.error,
    
    // Cores individuais (acesso direto)
    colors: themeContext.theme.colors,
    
    // Funções
    updateTheme: themeContext.updateTheme,
    saveTheme: themeContext.saveTheme,
    applyTheme: themeContext.applyTheme,
    resetToDefault: themeContext.resetToDefault,
    
    // Utilitários
    getColor: themeContext.getColorVariable,
    getVariables: themeContext.getAllColorVariables,
    
    // Métricas (se disponíveis)
    contrastMetrics: themeContext.theme.contrastMetrics,
  };
};
