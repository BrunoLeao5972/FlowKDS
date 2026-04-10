/**
 * ThemeConfigPanel.tsx - Painel simplificado de customização de tema
 * 
 * ⚠️ ESCOPO: APENAS PAINEL PÚBLICO (Frente de Loja)
 * Esta feature é exclusiva para personalizar a aparência do painel de exibição
 * pública (/display - onde clientes veem pedidos prontos).
 * 
 * NÃO afeta:
 * - Admin Page (gerenciamento de pedidos)
 * - Kitchen Page (monitor de cozinha)
 * - Outras telas do sistema
 * 
 * Design focado em usabilidade para usuários leigos.
 * Agrupa cores por função em categorias visuais intuitivas.
 */

import React, { useState } from 'react';
import { useTheme, Theme } from '@/contexts/ThemeContext';
import { AlertCircle, Lightbulb, RotateCcw, Palette, Zap, Eye } from 'lucide-react';

interface ThemeConfigPanelProps {
  onClose?: () => void;
}

// Cores padrão do sistema
const DEFAULT_COLORS = {
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
};

export default function ThemeConfigPanel({ onClose }: ThemeConfigPanelProps) {
  const { theme, loading, error, updateTheme, saveTheme, activateTheme, savedThemes, listThemes } = useTheme();
  const [localColors, setLocalColors] = useState<Theme['colors']>(() => {
    // Se tema existe e tem cores, usa elas
    if (theme?.colors) {
      return theme.colors;
    }
    // Caso contrário, inicializa com cores padrão
    return DEFAULT_COLORS;
  });
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [activatingThemeId, setActivatingThemeId] = useState<string | null>(null);
  const [themeName, setThemeName] = useState('');
  const [themeDescription, setThemeDescription] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  // Sincroniza localColors com theme quando o tema mudar
  React.useEffect(() => {
    if (theme?.colors) {
      setLocalColors(theme.colors);
    }
  }, [theme?.id, theme?.colors]);

  // Carrega lista de temas salvos ao montar
  React.useEffect(() => {
    listThemes();
  }, [listThemes]);

  const getApiBase = () => {
    if (typeof window === 'undefined') return '';
    if (window.location.port === '5173') {
      return `${window.location.protocol}//${window.location.hostname}:8081`;
    }
    return window.location.origin;
  };

  /**
   * Atualiza uma cor no estado local
   */
  const handleColorChange = (key: keyof Theme['colors'], hex: string) => {
    setLocalColors(prev => ({
      ...prev,
      [key]: { ...prev[key], hex: hex.toUpperCase() }
    }));
  };

  /**
   * Salva as cores atualizadas no contexto
   */
  const handleApplyColors = async () => {
    try {
      // Garante que todas as cores têm estrutura { hex: '#...' }
      const normalizedColors = Object.entries(localColors).reduce((acc, [key, value]) => {
        acc[key] = {
          hex: typeof value === 'string' ? value : (value?.hex || '#000000')
        };
        return acc;
      }, {} as Theme['colors']);

      await updateTheme(normalizedColors);
      setSaveSuccess('Cores aplicadas com sucesso!');
      setTimeout(() => setSaveSuccess(''), 3000);
    } catch (err) {
      setSaveError(`Erro ao aplicar cores: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
    }
  };

  /**
   * Solicita sugestão de paleta ao servidor
   */
  const handleSuggestPalette = async () => {
    if (!localColors.primary?.hex) {
      setSaveError('Selecione a cor primária para gerar sugestões');
      return;
    }

    setSuggestLoading(true);
    setSaveError('');
    try {
      const response = await fetch(
        `${getApiBase()}/saas/themes/suggest/palette?primaryColor=${encodeURIComponent(localColors.primary.hex)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('kds_auth_token') || ''}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Erro ${response.status}`);
      }

      const data = await response.json();
      const suggestedColors = data.palette || data;
      
      // Aplica as cores sugeridas
      setLocalColors(suggestedColors);
      setSaveSuccess('Paleta sugerida carregada!');
      setTimeout(() => setSaveSuccess(''), 3000);
    } catch (err) {
      console.error('Erro ao sugerir paleta:', err);
      setSaveError('Erro ao gerar sugestão de paleta');
    } finally {
      setSuggestLoading(false);
    }
  };

  /**
   * Salva o tema atual com um nome
   */
  const handleSaveTheme = async () => {
    if (!themeName.trim()) {
      setSaveError('Digite um nome para o tema');
      return;
    }

    setSaveLoading(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      // ⚠️ Garante que as cores locais sejam aplicadas ANTES de salvar
      // Normaliza localColors para formato correto
      const normalizedColors = Object.entries(localColors).reduce((acc, [key, value]) => {
        acc[key] = {
          hex: typeof value === 'string' ? value.toUpperCase() : (value?.hex || '#000000').toUpperCase()
        };
        return acc;
      }, {} as Theme['colors']);

      // Atualiza o tema com as cores normalizadas
      await updateTheme(normalizedColors);
      
      // Agora salva com as cores atualizadas
      await saveTheme(themeName, themeDescription);
      setSaveSuccess(`Tema "${themeName}" salvo com sucesso!`);
      setThemeName('');
      setThemeDescription('');
      
      // Recarrega lista de temas para atualizar a seleção
      await listThemes();
      
      setTimeout(() => setSaveSuccess(''), 3000);
    } catch (err) {
      console.error('Erro ao salvar tema:', err);
      setSaveError(`Erro ao salvar tema: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
    } finally {
      setSaveLoading(false);
    }
  };

  /**
   * Volta para as cores padrão do sistema
   */
  const handleResetToDefault = async () => {
    try {
      setLocalColors(DEFAULT_COLORS);
      await updateTheme(DEFAULT_COLORS);
      setSaveSuccess('Cores padrão restauradas!');
      setTimeout(() => setSaveSuccess(''), 3000);
    } catch (err) {
      setSaveError('Erro ao restaurar cores padrão');
    }
  };

  // Organiza cores em categorias intuitivas para usuários leigos
  const colorCategories = [
    {
      title: '🎨 Aparência Geral',
      description: 'Cores principais da interface',
      icon: Palette,
      fields: [
        { key: 'primary', label: 'Cor Principal', hint: 'Botões e elementos destacados' },
        { key: 'secondary', label: 'Cor Secundária', hint: 'Elementos alternativos' },
        { key: 'background', label: 'Fundo da Tela', hint: 'Cor de fundo geral' },
        { key: 'surface', label: 'Superfície (Painéis)', hint: 'Fundo de caixas e painéis' },
      ]
    },
    {
      title: '📝 Textos',
      description: 'Cores de texto',
      icon: Eye,
      fields: [
        { key: 'text', label: 'Texto Principal', hint: 'Títulos e textos normais' },
        { key: 'textSecondary', label: 'Texto Secundário', hint: 'Subtítulos e labels' },
        { key: 'border', label: 'Linhas e Bordas', hint: 'Separadores' },
      ]
    },
    {
      title: '⚡ Status & Feedback',
      description: 'Cores para alertas e mensagens',
      icon: Zap,
      fields: [
        { key: 'success', label: 'Sucesso (Verde)', hint: 'Operações bem-sucedidas' },
        { key: 'warning', label: 'Aviso (Amarelo)', hint: 'Atenção necessária' },
        { key: 'error', label: 'Erro (Vermelho)', hint: 'Problemas e erros' },
        { key: 'accent', label: 'Destaque (Extra)', hint: 'Ênfase especial' },
      ]
    }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mb-2"></div>
          <p className="text-sm text-muted-foreground">Carregando tema...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Avisos e mensagens */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 dark:bg-red-950/20 p-3 flex gap-2 text-sm text-red-700 dark:text-red-400">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saveError && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 dark:bg-red-950/20 p-3 flex gap-2 text-sm text-red-700 dark:text-red-400">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50/50 dark:bg-green-950/20 p-3 text-sm text-green-700 dark:text-green-400">
          ✓ {saveSuccess}
        </div>
      )}

      {/* Categorias de cores */}
      <div className="space-y-4">
        {colorCategories.map((category) => {
          const IconComponent = category.icon;
          return (
            <div key={category.title} className="rounded-lg border border-border bg-muted/5 p-4">
              {/* Header da categoria */}
              <div className="flex items-start gap-2 mb-4 pb-3 border-b border-border">
                <IconComponent size={18} className="text-orange-500 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-sm">{category.title}</h3>
                  <p className="text-xs text-muted-foreground">{category.description}</p>
                </div>
              </div>

              {/* Cores da categoria */}
              <div className="space-y-3">
                {category.fields.map(field => (
                  <div key={field.key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="block text-sm font-medium">{field.label}</label>
                        <p className="text-xs text-muted-foreground">{field.hint}</p>
                      </div>
                    </div>
                    <div className="flex gap-3 items-center">
                      {/* Preview da cor */}
                      <div
                        className="h-12 w-16 rounded-lg border-2 border-border shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                        style={{ backgroundColor: localColors[field.key]?.hex || '#000000' }}
                        onClick={() => document.getElementById(`color-${field.key}`)?.click()}
                        title="Clique para alterar"
                      />
                      {/* Input de cor */}
                      <input
                        id={`color-${field.key}`}
                        type="color"
                        value={localColors[field.key]?.hex || '#000000'}
                        onChange={e => handleColorChange(field.key, e.target.value)}
                        className="h-12 w-16 rounded cursor-pointer border border-border"
                      />
                      {/* Código hex */}
                      <input
                        type="text"
                        value={localColors[field.key]?.hex || '#000000'}
                        onChange={e => handleColorChange(field.key, e.target.value)}
                        className="flex-1 h-10 px-3 rounded text-sm font-mono border border-border bg-background"
                        placeholder="#000000"
                        maxLength={7}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Indicador de Qualidade - desabilitado por enquanto */}
      {false && (
        <div className="rounded-lg border border-border bg-blue-50/30 dark:bg-blue-950/20 p-3">
          <div className="flex gap-2 items-start text-sm">
            <div className="text-blue-600 dark:text-blue-400 font-bold">ℹ️</div>
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-300">Legibilidade das cores</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                Verifique o contraste das suas cores.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Buttons para ações */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleApplyColors}
          className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-orange-500 text-white hover:bg-orange-600 transition-colors"
        >
          ✓ Aplicar Essas Cores
        </button>
        <button
          onClick={handleResetToDefault}
          className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border hover:bg-muted transition-colors flex items-center gap-1.5"
        >
          <RotateCcw size={14} />
          Voltar ao Padrão
        </button>
      </div>

      {/* Setor de salvar tema (opcional) */}
      <div className="rounded-lg border border-border bg-green-50/30 dark:bg-green-950/20 p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-sm">💾 Salvar Como Novo Tema</h3>
          <p className="text-xs text-muted-foreground mt-1">Dê um nome a essa combinação de cores para usar depois</p>
        </div>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Ex: Verde Corporativo, Azul Minimalista, Laranja Quente..."
            value={themeName}
            onChange={e => setThemeName(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
          />
          <textarea
            placeholder="Descrição (opcional) - Ex: Tema para uso diurno, mais suave..."
            value={themeDescription}
            onChange={e => setThemeDescription(e.target.value)}
            className="w-full h-14 px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none"
          />
        </div>
        <button
          onClick={handleSaveTheme}
          disabled={saveLoading || !themeName.trim()}
          className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveLoading ? '⏳ Salvando...' : '✓ Salvar Esse Tema'}
        </button>
      </div>

      {/* Temas Salvos */}
      {savedThemes && savedThemes.length > 0 && (
        <div className="rounded-lg border border-border bg-blue-50/30 dark:bg-blue-950/20 p-4 space-y-3">
          <h3 className="font-semibold text-sm">📋 Temas Salvos</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {savedThemes.map((savedTheme) => {
              const isActive = theme?.id === savedTheme.id;
              return (
                <div
                  key={savedTheme.id}
                  className={`p-3 rounded-lg border transition-all cursor-pointer gap-2 flex items-center justify-between ${
                    isActive
                      ? 'border-blue-500 bg-blue-100/50 dark:bg-blue-950/50'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{savedTheme.name}</p>
                      {isActive && (
                        <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap">
                          ✓ Ativo
                        </span>
                      )}
                    </div>
                    {savedTheme.description && (
                      <p className="text-xs text-muted-foreground truncate">{savedTheme.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={async () => {
                        if (savedTheme.id) {
                          setActivatingThemeId(savedTheme.id);
                          try {
                            await activateTheme(savedTheme.id);
                            setSaveSuccess(`Tema "${savedTheme.name}" ativado com sucesso!`);
                            setTimeout(() => setSaveSuccess(''), 3000);
                          } catch (err) {
                            setSaveError(`Erro ao ativar tema: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
                          } finally {
                            setActivatingThemeId(null);
                          }
                        }
                      }}
                      disabled={activatingThemeId !== null || isActive}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-gray-300 text-gray-600 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400'
                          : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                    >
                      {activatingThemeId === savedTheme.id ? '⏳' : '✓'} {isActive ? 'Ativo' : 'Usar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
