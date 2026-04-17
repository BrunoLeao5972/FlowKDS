# Release 2.0.2 - 2026-04-16

## Resumo
Release de consolidacao funcional do FOX KDS com foco em experiencia operacional: configuracao de sons mais simples, persistencia local mais confiavel e blindagem contra duplicidade de pedidos em cenarios de maquinas lentas.

## Versoes
- App version: 2.0.2
- Frontend package: 2.0.2
- Server package: 10.4.26 (sem alteracao nesta release)

## Principais Entregas

### 1. Configuracao de sons no modal
- Separacao da area de Tema em subabas de Temas e Sons.
- Inclusao de lista de sons prontos do sistema, com suporte a upload, teste e caminho customizado.
- Som padrao de novo pedido definido via asset publico.

Arquivos principais:
- src/components/ConfigDialog.tsx
- src/contexts/SettingsContext.tsx
- public/Songs/Efeito Sonoro - Chegou Pedido.mp3
- public/Songs/Efeito Sonoro - Pedido Pronto.mp3

### 2. Persistencia da ultima configuracao do cliente
- Alteracoes de audio passam a ser gravadas imediatamente no contexto de configuracoes e refletidas no armazenamento local.
- Evita que o cliente tenha que reconfigurar sons ao reabrir o sistema.

Arquivos principais:
- src/components/ConfigDialog.tsx
- src/contexts/SettingsContext.tsx

### 3. Protecao contra duplicidade em PCs lentos
- Backend legado passou a respeitar `externalId` para tornar criacao de pedidos idempotente.
- Frontend passou a deduplicar snapshot inicial e eventos de socket por identidade de pedido.

Arquivos principais:
- server/index.js
- server/models/Order.js
- src/contexts/OrderContext.tsx
- src/types/order.ts

### 4. Ajustes de usabilidade e ativos visuais
- Limite de nome do cliente no painel publico para preservar o layout dos cards.
- Atualizacao de imagens de login e reorganizacao de assets antigos.
- Inicializador `start-kds.js` refinado para gerar logs e subir server + bridge com mais previsibilidade.

Arquivos principais:
- src/lib/customerName.ts
- src/pages/PublicDisplayPage.tsx
- public/login-bg.png
- public/loginkdscelular.png
- public/loginkdscelular-old.png
- public/Olds/-old.png
- start-kds.js
- vite.config.ts

## Validacoes executadas
1. `npm run build`

## Observacoes para Publicacao
- O commit inclui tambem a documentacao de release `2.0.1` que estava pendente de versionamento no repositório.
- Ha alteracoes de assets binarios no diretório `public`, entao o pacote final deve ser revisado visualmente antes de distribuicao ao cliente.

## Changelog Curto
- feat(config): adiciona subaba de sons com selecao e teste de MP3
- fix(settings): persiste imediatamente a ultima configuracao de som
- fix(orders): evita duplicidades por `externalId` em fluxo lento
- fix(display): limita nome do cliente no card do painel
- chore(version): atualiza versao para 2.0.2