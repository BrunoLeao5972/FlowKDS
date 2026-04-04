# Sistema KDS - Kitchen Display System

Sistema de gerenciamento de pedidos para cozinha, balcão e painel público, com autenticação, persistência em MongoDB, sincronização em tempo real e configurações operacionais para uso em ambiente de restaurante.

## Visão Geral

O projeto é dividido em três áreas principais:

- Painel administrativo para criar, editar, remover e acompanhar pedidos.
- Tela da cozinha para operação interna com foco em preparo e andamento.
- Display público para exibir pedidos prontos para retirada.

## Arquitetura SaaS (Cloud + Offline)

Para a proposta SaaS multi-tenant com sincronização offline-first, consulte:

- `docs/saas-architecture.md`

Além do fluxo base de pedidos, o sistema agora inclui autenticação, gerenciamento de usuários, sons configuráveis, numeração flexível de pedidos e tela de login responsiva.

## Implementações Recentes

- Autenticação com tela de login e proteção de rotas no frontend.
- Backend com persistência em MongoDB via Mongoose.
- Login por usuário principal do `.env` e também por usuários cadastrados no banco.
- Gestão de usuários dentro de Configurações > Usuários.
- Senhas com hash seguro no backend.
- Sincronização em tempo real com Socket.IO para criação, atualização e remoção de pedidos.
- Sons configuráveis para novo pedido e pedido pronto.
- Configuração de numeração contínua, reset diário ou número inicial personalizado.
- Tela de login com imagem específica para mobile e imagem separada para desktop.
- Ajustes de navegação, logout, paginação de usuários e normalização de nomes exibidos.
- **Cadastro do restaurante**: campos de nome fantasia, razão social e CNPJ (máscara `XX.XXX.XXX/XXXX-XX`, validação de 14 dígitos).
- **Endereço detalhado**: CEP (máscara `XXXXX-XXX`, validação de 8 dígitos), logradouro, número, cidade e complemento como campos independentes.
- **Importação de licença**: botão na aba Restaurante para carregar um arquivo de licença (`.lic`, `.json` ou `.txt`), com nome e opção de remoção.
- **Aba Restaurante como ponto de entrada**: é a primeira aba do modal de configurações; inclui o alternador de tema (claro/escuro) de forma discreta no topo.
- **Alternância de tema acessível**: botão de tema embutido na aba Restaurante.

## Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui.
- Backend: Node.js, Express, MongoDB, Mongoose, Socket.IO.
- Autenticação: token assinado no servidor + usuários persistidos no MongoDB.
- Estado e integração: Context API, `fetch` e eventos em tempo real.
- Testes: Vitest no frontend e script de teste de conexão com banco no backend.

## Funcionalidades

- Cadastro manual de pedidos pelo painel admin.
- Atualização de status entre `received`, `preparing`, `ready`, `delivered` e `cancelled`.
- Exibição separada por contexto: admin, cozinha e painel público.
- Cálculo de tempo médio e controle visual por tempos de alerta/crítico.
- Login obrigatório para acessar admin, cozinha e display.
- Criação e remoção de usuários pela interface.
- Sons customizados salvos localmente no navegador.
- Numeração de pedidos configurável nas preferências do sistema.
- Interface responsiva, incluindo background dedicado para login em celular.
- Dados cadastrais do restaurante (nome fantasia, razão social, CNPJ com máscara e validação).
- Endereço decomposto em CEP, logradouro, número, cidade e complemento, com validação de formato.
- Importação e armazenamento de arquivo de licença diretamente pelo modal de configurações.
- Controle de permissões por usuário (admin, cozinha, display, configurações, cozinheiro).
- Relatórios operacionais exportáveis em CSV e PDF.

## Rotas da Aplicação

- `/login` - Tela de autenticação.
- `/` - Painel administrativo.
- `/kitchen` - Tela da cozinha.
- `/display` - Painel público.

## Estrutura Técnica

### Frontend

- `src/App.tsx`: registra providers, navegação, rotas protegidas e página de login.
- `src/contexts/AuthContext.tsx`: controla login, logout, token e persistência da sessão.
- `src/contexts/OrderContext.tsx`: integra com a API, mantém pedidos em memória e consome Socket.IO.
- `src/contexts/SettingsContext.tsx`: persiste preferências locais como tempos, sons, numeração, dados cadastrais do restaurante (nome fantasia, razão social, CNPJ, CEP, logradouro, número, cidade, complemento) e conteúdo de licença.
- `src/components/ConfigDialog.tsx`: centraliza configuração de timers, tema, numeração, usuários, permissões, relatórios e dados do restaurante; inclui máscaras de CNPJ/CEP, validação antes de salvar e importação de arquivo de licença.
- `src/pages/LoginPage.tsx`: tela de login com backgrounds distintos para desktop e mobile.

### Backend

- `server/index.js`: API principal, autenticação, CRUD de usuários, CRUD de pedidos e eventos Socket.IO.
- `server/mongo.js`: conexão com MongoDB.
- `server/models/Order.js`: model de pedidos.
- `server/models/User.js`: model de usuários com hash de senha.
- `server/models/AuthConfig.js`: suporte à configuração de autenticação principal.
- `server/scripts/test-db-connection.js`: teste rápido de conectividade com o banco.

## Documentação de Código e Manutenção

Esta base agora possui comentários técnicos nos pontos críticos de operação para facilitar onboarding, suporte e evolução segura.

Arquivos com foco de documentação técnica:

- `src/contexts/OrderContext.tsx`: normalização de payload, filtros por modo de atendimento, estratégia de atualização otimista, sincronização por Socket.IO e fluxo de impressão.
- `src/contexts/AuthContext.tsx`: ciclo de vida da sessão (persistência, restauração e limpeza), permissões e login.
- `src/contexts/SettingsContext.tsx`: persistência local, carga remota de dados do restaurante e regras de numeração de pedidos.
- `src/App.tsx`: ordem dos providers e dependências entre contextos.
- `server/index.js`: autenticação legada/SaaS, validação de token, regras de transição de status e middleware de socket.
- `src/pages/AdminPage.tsx`: pipeline de filtros, paginação e atualização periódica da visão administrativa.
- `src/pages/PublicDisplayPage.tsx`: separação de filas (preparo/pronto) e atualização contínua para painel público.
- `server/services/pedidoPrinter.js`: estratégia de impressão (GDI + fallback RAW), validação de impressora e geração de saída alternativa.
- `server/saas/syncWorker.js`: aplicação idempotente de eventos, retry com backoff e emissão para salas por tenant.
- `start-kds.js`: orquestração local de processos, logs e auto-restart do bridge SQL.

Diretrizes adotadas para comentários:

- Explicar decisões e regras de negócio, não o óbvio da sintaxe.
- Destacar integrações que afetam comportamento (API, socket, impressão e localStorage).
- Registrar compatibilidades legadas e fallbacks para operação offline ou com bloqueios do navegador.

Checklist de manutenção recomendada:

1. Validar build após mudanças em contexto/estado: `npm run build`.
2. Validar backend e conexão de banco: `cd server && npm run test:db`.
3. Revisar transições de status ao alterar fluxo de cozinha (`received`, `preparing`, `ready`, `delivered`, `cancelled`).
4. Revisar compatibilidade de `serviceMode` quando integrar novas fontes de pedidos.
5. Confirmar se comentários continuam aderentes ao comportamento real após refactors.

## Requisitos

- Node.js 18 ou superior.
- npm.
- MongoDB local ou MongoDB Atlas.
- Portas livres:
  - `5173` para o frontend em desenvolvimento.
  - `8081` para a API.

## Instalação

1. Clone o repositório:

```powershell
git clone https://github.com/BrunoLeao5972/KDS.git
cd kitchen-flow
```

2. Instale as dependências do frontend e do backend:

```powershell
npm install
cd server
npm install
cd ..
```

3. Configure o backend:

```powershell
Copy-Item .\server\.env.example .\server\.env
```

4. Edite o arquivo `server/.env` conforme o ambiente.

Exemplo base:

```env
PORT=8081
HOST=0.0.0.0
MONGODB_URI=mongodb://127.0.0.1:27017/kds
CORS_ORIGIN=*
AUTH_ENABLED=true
AUTH_USERNAME=cliente
AUTH_PASSWORD=trocar-esta-senha
AUTH_TOKEN_SECRET=trocar-token-secret-grande
AUTH_TOKEN_TTL_HOURS=12
```

Observações:

- O usuário e senha acima são apenas o valor de exemplo do arquivo `.env.example`.
- O login real depende do conteúdo do seu `server/.env` ou dos usuários cadastrados no MongoDB.
- Se `AUTH_ENABLED=false`, o backend aceita login sem validação rígida e retorna sessão sem token assinado.

## Como Rodar

### Opção 1: frontend e backend separados

Terminal 1:

```powershell
cd server
npm run dev
```

Terminal 2:

```powershell
npm run dev
```

### Opção 2: tudo junto

```powershell
npm run dev:all
```

Em desenvolvimento:

- Frontend: `http://localhost:5173`
- API: `http://localhost:8081`

## Scripts Úteis

### Raiz

```powershell
npm run dev
npm run dev:all
npm run build
npm run preview
npm run lint
npm run test
```

### Backend

```powershell
cd server
npm run dev
npm run dev:watch
npm start
npm run test:db
```

## Configurações do Sistema

No botão `Configurações`, o sistema permite ajustar:

- Tempo médio, tempo de alerta e tempo crítico.
- Tema da interface.
- Numeração contínua, reset diário ou número inicial customizado.
- Upload e teste de som para novo pedido.
- Upload e teste de som para pedido pronto.
- Ativação e desativação individual dos sons.
- Cadastro e exclusão de usuários.

Os sons e demais preferências de interface são persistidos localmente no navegador via `localStorage`.

## Autenticação e Usuários

- O endpoint de login é `POST /auth/login`.
- O usuário principal pode vir do `.env`.
- Usuários adicionais são armazenados na coleção `users` do MongoDB.
- As rotas de pedidos e usuários exigem autenticação quando `AUTH_ENABLED=true`.
- As senhas dos usuários cadastrados são armazenadas com hash usando `bcrypt`.

## API

### Autenticação

- `POST /auth/login` - autentica e retorna token.

### Usuários

- `GET /users` - lista usuários.
- `POST /users` - cria usuário.
- `DELETE /users/:id` - remove usuário.

### Pedidos

- `GET /orders` - lista pedidos.
- `GET /orders/:id` - detalha um pedido.
- `POST /orders` - cria pedido.
- `PATCH /orders/:id/status` - altera status.
- `PUT /orders/:id` - atualiza dados principais do pedido.
- `DELETE /orders/:id` - remove pedido.

Exemplo de criação de pedido:

```json
{
  "number": 123,
  "customerName": "João Silva",
  "items": [
    {
      "name": "Pizza",
      "quantity": 1,
      "notes": "Sem cebola"
    }
  ],
  "observations": "Mesa 5"
}
```

## Tempo Real

O backend emite eventos Socket.IO para:

- `orders:created`
- `orders:updated`
- `orders:deleted`

O frontend consome esses eventos para manter as telas sincronizadas sem depender apenas de atualização manual.

## Build e Produção

Para gerar o build do frontend:

```powershell
npm run build
```

Depois disso, o backend consegue servir a pasta `dist` automaticamente quando ela existir.

## Verificações Rápidas

```powershell
node -v
npm -v
git status
cd server; npm run test:db
```

## Observações Operacionais

- Se o sistema for acessado por outras máquinas da rede, libere as portas `5173` e `8081` quando necessário.
- Em produção, prefira HTTPS e um proxy reverso na frente da API.
- O login mobile usa asset específico separado do background desktop.

## Deploy

- Para deploy com MongoDB Atlas e serviços externos, consulte `DEPLOYMENT.md`.
