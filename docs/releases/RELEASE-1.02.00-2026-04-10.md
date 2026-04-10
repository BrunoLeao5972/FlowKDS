# Release 10.04.26 - 2026-04-10

## Resumo
Esta release consolida melhorias de UX no painel publico, reorganizacao de configuracoes, reforco de regras de modalidade de atendimento, permissao de relatorios e persistencia de configuracoes no banco.

## Versoes
- App version: 10.04.26
- Frontend package: 10.4.26
- Server package: 10.4.26

## Principais Entregas

### 1. Painel Publico e Tema
- Melhorias visuais no display publico (preparo x pronto) com melhor contraste em modo escuro.
- Ajuste de titulo "EM PREPARO" para ganhar destaque no tema claro.
- Remocao de inconsistencias visuais no card de "Pronto para retirada".
- Ajustes de layout fullscreen e comportamento de footer para evitar scroll indevido.

Arquivos principais:
- src/pages/PublicDisplayPage.tsx
- src/styles/theme.css
- src/App.tsx

### 2. Configuracoes (UX e Organizacao)
- Modal de configuracoes redesenhado com navegacao lateral.
- Aba de permissoes reorganizada em formato mais compacto/legivel.
- Aba de usuarios otimizada com busca, badges e melhor uso de espaco.
- Inclusao da permissao "Relatorios" no fluxo de usuarios/permissoes.

Arquivos principais:
- src/components/ConfigDialog.tsx

### 3. Regras de Modalidade de Atendimento
- Bloqueio de pedidos com modalidade nao habilitada no backend.
- Validacao aplicada em criacao e atualizacao de pedido.
- Persistencia de modalidades habilitadas no backend.

Arquivos principais:
- server/index.js
- server/models/RestaurantSettings.js
- src/components/AppNav.tsx

### 4. Persistencia Completa de Configuracoes no Banco
- Expansao do schema de configuracoes para armazenar dados operacionais e visuais.
- Endpoints de settings retornando/salvando campos completos.
- Hidracao de configuracoes no frontend a partir do backend.

Campos cobertos:
- tempos (medio, alerta, critico)
- dados de restaurante e endereco
- numeracao de pedidos
- modalidades habilitadas
- configuracoes de impressao
- audio e flags de audio
- cores de painel e animacoes

Arquivos principais:
- server/models/RestaurantSettings.js
- server/index.js
- src/contexts/SettingsContext.tsx
- src/components/AppNav.tsx

### 5. Tempo Medio Diario no Admin
- Ajuste para calcular tempo medio apenas com pedidos finalizados no dia atual.
- Comportamento agora reseta diariamente no painel admin.

Arquivo principal:
- src/contexts/OrderContext.tsx

## Ajustes Tecnicos Relevantes
- Atualizacao automatica de impressora no .env ao salvar configuracoes de impressao.
- Padronizacao de respostas de settings com defaults seguros.

## Observacoes para Publicacao
- Existem arquivos de estado/runtime que nao devem entrar no versionamento de release:
  - server/scripts/.sql2014-bridge-state.json
  - server/scripts/.sql2014-bridge.pid

## Checklist de Release
1. Reiniciar backend para carregar schema e rotas atualizadas.
2. Validar fluxo de configuracoes (salvar e recarregar).
3. Validar bloqueio de modalidade desabilitada (ex.: mesa).
4. Validar impressao apos troca de impressora.
5. Validar painel publico em modo claro/escuro.
6. Validar tempo medio diario no admin.

## Changelog Curto
- feat(settings): persistencia completa de configuracoes no banco
- feat(orders): bloqueio por modalidade habilitada
- feat(authz): permissao de relatorios
- feat(ui): redesign de configuracoes e melhorias em usuarios/permissoes
- fix(display): visual de pronto para retirada no modo noturno
- fix(metrics): tempo medio diario no admin
