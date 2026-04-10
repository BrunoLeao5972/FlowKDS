# Sistema de Temas - Documentação Completa

**Data:** 08/04/2026  
**Status:** ✅ Implementação Completa  
**Build:** ✅ Sucesso (exit code 0) - 2108 módulos transformados

---

## 📋 Visão Geral

Sistema enterprise-grade de gerenciamento de temas para o Platform KDS, com:
- ✅ 11 cores customizáveis por tema
- ✅ Validação WCAG 2.1 automática (contraste de acessibilidade)
- ✅ Persistência multi-tenant em MongoDB
- ✅ API RESTful completa (CRUD + validação + sugestão)
- ✅ React Context para estado global
- ✅ CSS Variables para aplicação dinâmica
- ✅ UI de configuração com color pickers e preview
- ✅ Salvamento de múltiplos temas nomeados
- ✅ Sugestão automática de paleta de cores

---

## 🏗️ Arquitetura

```
Frontend (React)                Backend (Node.js)          Database
    ↓                               ↓                         ↓
ThemeContext ←→ Theme Routes ←→ Mongoose Model ←→ MongoDB
    ↓
CSS Variables
    ↓
DOM (:root)
```

---

## 📁 Estrutura de Arquivos Criados

### Backend

#### `server/models/Theme.js` (368 linhas)
**Mongoose Schema para persistência de temas**

```javascript
// Estrutura do documento MongoDB
{
  _id: ObjectId,
  tenantId: string,          // Multi-tenant isolation
  name: string,              // "Azul Minimalista"
  description: string,       // Opcional
  isActive: boolean,         // Tema ativo para o tenant
  createdAt: Date,
  updatedAt: Date,
  colors: {
    primary: { hex: "#FF6B35" },
    secondary: { hex: "#457B9D" },
    background: { hex: "#FFFFFF" },
    surface: { hex: "#F5F5F5" },
    text: { hex: "#1A1A1A" },
    textSecondary: { hex: "#666666" },
    accent: { hex: "#E63946" },
    border: { hex: "#E0E0E0" },
    success: { hex: "#4CAF50" },
    warning: { hex: "#FFC107" },
    error: { hex: "#F44336" }
  },
  contrastMetrics: {
    primaryVsBackground: 4.5,      // Ratio
    textVsBackground: 8.2,
    textVsSurface: 6.1,
    wcagAACompliant: true,         // Atende WCAG AA
    wcagAAACompliant: true         // Atende WCAG AAA
  }
}
```

**Métodos:**
- `hexToRgb()` - Converte hex para RGB
- `getLuminance()` - Calcula luminância relativa (WCAG)
- `getContrastRatio()` - Calcula razão de contraste
- `toCSSVariables()` - Gera object com variáveis CSS
- `toJSON()` - Serialização customizada

**Middleware:**
- Pre-save: Auto-ativa tema (desativa outros), calcula contraste
- Schema indexes: `{tenantId, isActive}`, `{tenantId, name}` (unique)

#### `server/services/ThemeValidator.js` (280+ linhas)
**Serviço standalone de validação WCAG e manipulação de cores**

```typescript
ThemeValidator
├── hexToRgb(hex: string): RGB
├── rgbToHex(r, g, b): string
├── isValidHex(hex: string): boolean
├── getLuminance(hex: string): number
├── getContrastRatio(hex1, hex2): number
├── validateTheme(theme): { isValid, errors[], warnings[], metrics }
├── lightenColor(hex, percent): string      // 0-100%
├── darkenColor(hex, percent): string
└── suggestPalette(primaryHex): { 11 cores }
```

**Algoritmos:**
- Conversão hex ↔ RGB lossless
- Luminância relativa per WCAG 2.1 Level AAA
- Contraste: ratio de 1-21 (min 4.5 para AA, 7 para AAA)
- Paleta: cores complementárias, análogas, triádicas baseadas no primário

#### `server/saas/themeRoutes.js` (400+ linhas)
**Express REST API com 8 endpoints**

```
GET    /themes                      → Listar temas com paginação
GET    /themes/active               → Tema ativo ou padrão
GET    /themes/:id                  → Obter tema específico
POST   /themes                      → Criar novo tema
PUT    /themes/:id                 → Atualizar cores do tema
DELETE /themes/:id                  → Deletar (ativa próximo se era ativo)
POST   /themes/:id/activate         → Ativar tema
GET    /themes/suggest/palette      → Gerar paleta sugerida
```

**Features:**
- Validação de cores antes de salvar
- Isolamento por `tenantId` (todos os GET/POST filtram)
- Tratamento de erros: 400 (validação), 404 (não encontrado), 500 (erro)
- Duplicate name check com índice unique
- Auto-ativação de tema novo (middleware do model)

---

### Frontend

#### `src/contexts/ThemeContext.tsx` (380 linhas)
**React Context para gerenciamento global de temas**

```typescript
Interface ThemeContextType {
  // State
  theme: Theme | null
  loading: boolean
  error: string | null
  
  // Actions
  loadTheme(themeId?: string): Promise<void>
  updateTheme(colors: Theme['colors']): Promise<void>
  saveTheme(name, description?): Promise<void>
  applyTheme(theme: Theme): void
  resetToDefault(): void
  
  // Utilities
  getColorVariable(key): string
  getAllColorVariables(): Record<string, string>
}
```

**Behavior:**
- Carrega tema ativo ao montar (GET /themes/active)
- Fallback para localStorage se API falhar
- Aplica CSS Variables automaticamente
- Sincroniza com servidor + localStorage

**Default Theme:**
```javascript
{
  primary: "#FF6B35",
  secondary: "#457B9D",
  background: "#FFFFFF",
  surface: "#F5F5F5",
  text: "#1A1A1A",
  textSecondary: "#666666",
  accent: "#E63946",
  border: "#E0E0E0",
  success: "#4CAF50",
  warning: "#FFC107",
  error: "#F44336"
}
```

#### `src/hooks/useThemeData.ts` (30 linhas)
**Hook customizado com API simplificada**

```typescript
useThemeData() {
  theme: Theme
  loading: boolean
  error: string
  colors: Theme['colors']
  
  updateTheme(colors): Promise<void>
  saveTheme(name, description?): Promise<void>
  applyTheme(theme): void
  resetToDefault(): void
  
  getColor(key): string
  getVariables(): Record<string, string>
  contrastMetrics?: ContrastMetrics
}
```

#### `src/components/ThemeConfigPanel.tsx` (250+ linhas)
**UI de configuração completa com color pickers**

**Seções:**
```
┌─────────────────────────────────────┐
│ Selecionador de Cores               │
│ ├─ Input color + Hex text           │
│ ├─ 11 campos (primary, secondary...)│
│ └─ Aplicar Cores / Sugerir Paleta   │
├─────────────────────────────────────┤
│ Métricas de Contraste (WCAG)        │
│ ├─ Primário vs Fundo: 4.5           │
│ ├─ Texto vs Fundo: 8.2              │
│ ├─ Texto vs Superfície: 6.1         │
│ └─ Status: ✓ AAA                    │
├─────────────────────────────────────┤
│ Salvar Como Novo Tema               │
│ ├─ Input: Nome do tema              │
│ ├─ Textarea: Descrição (opt)        │
│ └─ Button: Salvar Tema              │
└─────────────────────────────────────┘
```

**Features:**
- Real-time color picker (input color + text hex)
- Validação imediata de formato hex (#RRGGBB)
- Preview de métricas de contraste
- Botão "Sugerir Paleta" → API /themes/suggest/palette
- Salvar como novo tema nomeado (POST /themes)
- Messages de sucesso/erro com auto-dismiss

#### `src/App.tsx` (modificado)
**Integração do ThemeProvider**

```typescript
<QueryClientProvider>
  <TooltipProvider>
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <ThemeProvider>        {/* ← NEW */}
            <OrderProvider>
              <AppContent />
            </OrderProvider>
          </ThemeProvider>
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  </TooltipProvider>
</QueryClientProvider>
```

**Order of Providers:**
1. Auth - Define JWT token
2. Settings - Carrega preferências
3. **Theme** (NEW) - Carrega tema
4. Order - Usa auth + settings + theme

#### `src/index.css` (modificado)
**CSS Variables globais adicionadas**

```css
:root {
  /* Theme System Colors */
  --color-primary: #FF6B35;
  --color-secondary: #457B9D;
  --color-background: #FFFFFF;
  --color-surface: #F5F5F5;
  --color-text: #1A1A1A;
  --color-text-secondary: #666666;
  --color-accent: #E63946;
  --color-border: #E0E0E0;
  --color-success: #4CAF50;
  --color-warning: #FFC107;
  --color-error: #F44336;
}
```

**Usage em componentes:**
```tsx
<div style={{ color: 'var(--color-primary)' }}>
  Com tema dinâmico
</div>
```

#### `src/components/ConfigDialog.tsx` (modificado)
**Nova aba "Tema" para configuração**

```typescript
// Novo estado:
const [showThemePanel, setShowThemePanel] = useState(false);

// Nova aba no modal:
<button onClick={() => setShowThemePanel(true)}>
  Tema
</button>

// Renderização:
{showThemePanel && <ThemeConfigPanel onClose={() => setShowThemePanel(false)} />}
```

---

## 🔄 Fluxo de Dados

### Ao Carregar Aplicação:
```
App Mount
  ↓
ThemeProvider loads
  ↓
useEffect → loadTheme() [GET /themes/active]
  ↓
API Response { theme: {...colors, ...metrics} }
  ↓
applyThemeVariables(theme)
  ↓
document.documentElement.style.setProperty('--color-primary', '#FF6B35')
  ↓
CSS Variables updated in :root
  ↓
All components using var(--color-x) update dynamically
```

### Ao Mudar Cor no ConfigDialog:
```
Color Picker Change
  ↓
handleColorChange(key, newHex)
  ↓
setLocalColors(prev => {..., [key]: { hex: newHex }})
  ↓
User clicks "Aplicar Cores"
  ↓
updateTheme(localColors) [PUT /themes/:id]
  ↓
API validates colors + calculates contrast
  ↓
Response { theme: {...updated...} }
  ↓
setTheme(updatedTheme)
  ↓
applyThemeVariables(updatedTheme)
  ↓
CSS Variables updated immediately
  ↓
UI re-renders with new colors
```

### Ao Salvar Novo Tema:
```
Input: name = "Verde Minimalista"
  ↓
handleSaveTheme()
  ↓
saveTheme(name, description) [POST /themes]
  ↓
API creates new document with current colors
  ↓
Auto-activates new theme (middleware)
  ↓
Response { theme: {...new theme...} }
  ↓
Theme applied & CSS Variables updated
  ↓
Success message for 3s
```

---

## 📊 Tipos TypeScript

```typescript
// Theme
interface Theme {
  id?: string;
  name: string;
  description?: string;
  isActive: boolean;
  colors: {
    primary: ThemeColor;
    secondary: ThemeColor;
    background: ThemeColor;
    surface: ThemeColor;
    text: ThemeColor;
    textSecondary: ThemeColor;
    accent: ThemeColor;
    border: ThemeColor;
    success: ThemeColor;
    warning: ThemeColor;
    error: ThemeColor;
  };
  contrastMetrics?: {
    primaryVsBackground: number;
    textVsBackground: number;
    textVsSurface: number;
    wcagAACompliant: boolean;
    wcagAAACompliant: boolean;
  };
}

interface ThemeColor {
  hex: string;
  label?: string;
}
```

---

## 🔐 Segurança

✅ **Multi-tenant Isolation:**
- Todos os endpoints filtram por `req.user.tenantId`
- Schema index garante unicidade por tenant

✅ **Authentication:**
- Bearer token obrigatório em todos os requests
- Token extraído de `localStorage.getItem('kds_auth_token')`

✅ **Validation:**
- Cores validadas contra padrão hex (#RRGGBB)
- Duplication check via MongoDB unique index
- WCAG compliance calculado antes de salvar

✅ **Error Handling:**
- 400: Validação falhou
- 404: Tema não encontrado
- 500: Erro interno
- Nunca expostos detalhes sensíveis

---

## 🧪 Testes Manuais

### 1. Carregar tema padrão
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:8081/themes/active
```
**Esperado:** 200 OK com tema padrão

### 2. Listar temas do tenant
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:8081/themes
```
**Esperado:** 200 OK com array de temas

### 3. Criar novo tema
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Teste",
    "colors": { "primary": { "hex": "#FF0000" }, ...rest }
  }' \
  http://localhost:8081/themes
```
**Esperado:** 201 Created com novo tema

### 4. Gerar sugestão de paleta
```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:8081/themes/suggest/palette?primaryColor=%23FF6B35"
```
**Esperado:** 200 OK com 11 cores sugeridas

### 5. UI ConfigDialog
1. Abrir Settings (Config)
2. Clicar aba "Tema"
3. Selecionar cor no color picker
4. Clicar "Sugerir Paleta" → Carrega 11 cores
5. Clicar "Aplicar Cores" → Atualiza tema
6. Digitar nome + "Salvar Tema" → Cria novo tema nomeado

---

## 📝 Próximos Passos Possíveis

1. **Presets predefinidos:**
   - Fazer seed de temas (Light, Dark, HighContrast, Colorful)
   - Endpoint GET /themes/presets

2. **Temas dinâmicos por período:**
   - Temas automáticos horários (light morning, dark night)
   - Agendador de ativação

3. **Exportação/Importação de temas:**
   - Download JSON de tema
   - Upload para compartilhamento

4. **Animações:**
   - Transição de cores com CSS transitions
   - Configurável duração (instant, smooth, slow)

5. **Dark mode nativo:**
   - Detecção de `prefers-color-scheme`
   - Tema automático por hora

6. **Analytics:**
   - Rastrear temas mais usados
   - Combinações de cores preferidas

---

## 🚀 Deploy

**Build Status:** ✅ Sucesso
```
✓ 2108 modules transformed
✓ dist/index-n84uSXC7.js (591 kB minified)
✓ Build time: 4.81s
```

**Para produção:**
1. Seed database com tema padrão
2. Verificar CORS para API em produção
3. Testar localStorage fallback
4. Validar CSS Variables em browsers alvo

---

## 📖 Referências

- **WCAG 2.1 Contrast Calculator:** https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
- **CSS Custom Properties:** https://developer.mozilla.org/en-US/docs/Web/CSS/--*
- **Mongoose Middleware:** https://mongoosejs.com/docs/middleware.html
- **React Context:** https://react.dev/reference/react/useContext

---

**Desenvolvido:** 08/04/2026  
**Arquivo:** THEME_SYSTEM_IMPLEMENTATION.md
