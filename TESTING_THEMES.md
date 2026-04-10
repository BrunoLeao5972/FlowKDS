# 🧪 Guia de Teste - Persistência de Temas

## ✅ Pré-requisitos
- [ ] Servidor Node.js rodando (`npm start` na pasta `server/`)
- [ ] Frontend rodando (`npm run dev` ou `npm run build` + servidor Express)
- [ ] Usuário logado com credenciais válidas
- [ ] MongoDB conectado (local ou Atlas)

## 📋 Passos de Teste

### Teste 1: Salvar Novo Tema com ID

**Objetivo**: Verificar se novo tema recebe ID automática

```
1. Abrir Sistema KDS → ⚙️ Configurações → Aba "Tema"
2. Modificar cores (ex: mudar "Cor Principal" para #FF0000)
3. Clicar "✓ Aplicar Essas Cores"
4. Na seção "💾 Salvar Como Novo Tema":
   - Nome: "Vermelho Teste"
   - Descrição: "Tema para testes"
   - Clicar "✓ Salvar Esse Tema"
5. Aguardar mensagem "Tema "Vermelho Teste" salvo com sucesso!"

✅ ESPERADO: Tema aparece na seção "📋 Temas Salvos"
✅ ESPERADO: Tema tem um ID (não visível na UI, mas existe no servidor)
```

**Verificação no DevTools (Console)**:
```javascript
// No painel aberto, inspecione a rede (Network tab)
// POST /saas/themes deve retornar:
{
  "message": "Tema criado com sucesso",
  "theme": {
    "id": "507f1f77bcf86cd799439011",  // ← ID automática
    "name": "Vermelho Teste",
    "colors": { ... },
    "isActive": true
  }
}
```

---

### Teste 2: Selecionar Tema com "Usar"

**Objetivo**: Verificar se ativar tema persiste no servidor

```
1. [Continuar do Teste 1]
2. Criar outro tema diferente (ex: "Azul Teste" com #0000FF)
3. Na seção "📋 Temas Salvos", verificar:
   - [ ] "Azul Teste" tem indicador "✓ Ativo"
   - [ ] Botão "✓ Usar" está DESABILITADO (acinzentado)
   
4. Clicar "✓ Usar" em "Vermelho Teste"
5. Aguardar mensagem "Tema "Vermelho Teste" ativado com sucesso!"

✅ ESPERADO: 
   - "Vermelho Teste" agora tem indicador "✓ Ativo"
   - Seu botão fica DESABILITADO
   - "Azul Teste" perde o indicador "✓ Ativo"
   - Painel mostra cores do tema remelho (se aplicadas visualmente)
```

**Verificação no DevTools (Console)**:
```javascript
// Network tab: POST /saas/themes/:id/activate
// Response:
{
  "message": "Tema ativado com sucesso",
  "theme": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Vermelho Teste",
    "isActive": true,  // ← Agora é true
    "colors": { ... }
  }
}
```

---

### Teste 3: Persistência em Recarga de Página

**Objetivo**: Verificar se tema ativo é restaurado al recarregar

```
1. [Continuar do Teste 2 com "Vermelho Teste" ativo]
2. Pressionar F5 ou Ctrl+R para recarregar a página
3. Aguardar carregamento completo
4. Abrir ⚙️ Configurações → Aba "Tema" novamente

✅ ESPERADO:
   - "Vermelho Teste" ainda tem indicador "✓ Ativo"
   - Cores mostram a configuração do "Vermelho Teste"
```

**Verificação no localStorage** (DevTools > Application > Local Storage):
```javascript
// Chave: kds:theme:v1
// Deve conter o tema "Vermelho Teste" completo
localStorage.getItem('kds:theme:v1')
// {
//   "id": "507f1f77bcf86cd799439011",
//   "name": "Vermelho Teste",
//   "colors": { ... },
//   "isActive": true
// }
```

---

### Teste 4: Persistência em Outra Sessão

**Objetivo**: Verificar se tema persiste entre usuários/sessões

```
1. [Assumindo "Vermelho Teste" está ativo]
2. Abrir nova aba/janela (nova sessão do navegador)
3. Fazer login com mesmo usuário
4. Abrir ⚙️ Configurações → Aba "Tema"

✅ ESPERADO: "Vermelho Teste" ainda está "✓ Ativo"
✅ ESPERADO: Cores são as do "Vermelho Teste"
```

**Explicação**: O servidor mantém qual tema é `isActive` para cada usuário/tenant

---

### Teste 5: Fluxo Completo (Integração)

**Objetivo**: Teste end-to-end do sistema de temas

```
1. Salvar 3 temas:
   - Tema A (cores quentes: laranja, vermelho)
   - Tema B (cores frias: azul, verde)
   - Tema C (cores neutras: cinza, preto)

2. Ativar Tema A → Verificar indicador
3. Recarregar página → Verificar persistência
4. Ativar Tema B → Verificar mudança de indicador
5. Recarregar página → Verificar novo tema persiste
6. Ativar Tema C → Verificar última mudança

✅ ESPERADO: Tema ativo sempre persiste corretamente
```

---

## ⚠️ Casos de Erro (Testes Negativos)

### Erro 1: Tema sem nome

```
1. Deixar campo "Nome" vazio
2. Clicar "✓ Salvar Esse Tema"

✅ ESPERADO: Mensagem de erro "Digite um nome para o tema"
✅ ESPERADO: Tema NÃO é criado
```

### Erro 2: Falta de autenticação

```
1. Abrir DevTools → Application → Limpar cookies/localStorage
2. Tentar salvar tema

✅ ESPERADO: Erro 401 "Usuário não autenticado"
```

### Erro 3: Cores inválidas

```
1. No painel, modificar cores para valores inválidos (ex: "XYZ" em hexadecimal)
2. Tentar salvar tema

✅ ESPERADO: Erro de validação "Cores inválidas"
```

---

## 📊 Verificação de Dados no MongoDB

**Via MongoDB Compass ou shell**:

```javascript
// Conectar ao banco
use kds_database
db.themes.find()

// Resultado esperado:
[
  {
    "_id": ObjectId("507f1f77bcf86cd799439011"),
    "tenantId": ObjectId("..."),
    "name": "Vermelho Teste",
    "description": "Tema para testes",
    "isActive": true,
    "colors": {
      "primary": { "hex": "#FF0000" },
      "secondary": { "hex": "#457B9D" },
      // ... outras cores
    },
    "createdAt": ISODate("2026-04-08T14:30:00Z"),
    "updatedAt": ISODate("2026-04-08T14:30:00Z")
  },
  // ... outros temas
]
```

---

## 🎯 Sumário de Verificações

| Verificação | Status | Notas |
|---|---|---|
| Tema recebe ID ao salvar | ✅ | MongoDB ObjectId |
| Botão "Usar" ativa tema | ✅ | Chama POST /themes/:id/activate |
| Indicador "✓ Ativo" aparece | ✅ | Visual feedback |
| Tema persiste ao recarregar | ✅ | localStorage + localStorage |
| Tema persiste em nova sessão | ✅ | MongoDB isActive |
| Mensagens de sucesso/erro | ✅ | Toast notifications |
| Build sem erros | ✅ | TypeScript validado |

---

## 🚀 Se Tudo Passou!

Parabéns! 🎉 O sistema de persistência de temas está funcionando corretamente.

**Próximas melhorias opcionais**:
- [ ] Adicionar botão para deletar temas
- [ ] Adicionar botão para duplicar tema
- [ ] Adicionar ordenação/busca na lista de temas
- [ ] Adicionar preview visual das cores no tema listado
- [ ] Adicionar confirmação antes de ativar tema

