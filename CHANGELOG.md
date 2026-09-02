# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [Unreleased]

### Adicionado
- **Instalação como Serviço do Windows**: `install-service.cmd`/`uninstall-service.cmd` (via NSSM, vendorizado em `vendor/nssm/`) registram o `kds-server.exe` como serviço — sem janela visível, inicia sozinho no boot e reinicia sozinho se cair. `start-server.cmd`/`start-all.cmd` continuam disponíveis para rodar manualmente (debug).
- **`SQL2014_EXCLUDED_PRODUCT_TYPES`**: exclui itens do KDS pelo código de `Produtos.Tipo` (fixo do sistema de caixa, confirmado por teste): `A`=Taxa Adicional, `B`=Beneficiamento, `D`=Grade, `F`=Fabricação, `G`=Taxa de Entrega, `M`=Evento, `Q`=Equivalente, `R`=Perda, `T`=Patrimônio, `U`=Clube de Consumo, `X`=Taxa de Serviço. Padrão já ativado no `.env.example`. Serviço/Material de Expediente não têm código próprio (vêm como `Tipo=P`, produto normal) e continuam indo pro KDS.

## [2.1.1] - 2026-07-27

### Corrigido
- **Causa raiz do disco do SQL Server em 100% contínuo**: as duas queries do SQL2014 (principal e a de detecção leve de mudanças) filtravam com `COALESCE(coluna_a, coluna_b, ...) > @lastSyncAt`. SQL Server não consegue usar índice em cima de uma expressão `COALESCE` (não é sargable) — confirmado via `SET SHOWPLAN_TEXT`, isso forçava um **Clustered Index Scan de `Pedidos_Produtos` inteira** a cada poll (a cada poucos segundos, o tempo todo, mesmo sem nenhum pedido novo). Reescritas para comparar cada coluna isoladamente com `OR`, permitindo `Index Seek` nos índices já existentes. Mesmo resultado (validado linha a linha contra a versão antiga), ordens de magnitude mais barato.
- **Latência de ~10s até o pedido aparecer no KDS**: `SQL2014_IDLE_POLL_INTERVAL_MS` tinha piso de 15s, criado quando a checagem de ociosidade ainda era cara (item acima). Com a query sargable, o custo por poll é desprezível, então o padrão agora acompanha `SQL2014_POLL_INTERVAL_MS` (3s) — pedidos novos aparecem quase em tempo real de novo. Clientes já instalados precisam atualizar `SQL2014_IDLE_POLL_INTERVAL_MS` no `.env` (era 15000, recomendado 3000).

## [2.1.0] - 2026-07-27

### Alterado
- A sincronização com o SQL2014 deixou de ser um processo/exe separado (`kds-bridge.exe`) e passou a rodar dentro do próprio `kds-server.exe`, chamando a API via loopback HTTP. Elimina o segundo `.exe`/`.cmd` e o risco de o cliente ficar com a sincronização travada silenciosamente por um `pause` de erro sem ninguém no PC pra apertar uma tecla.
- `start-server.cmd` agora reinicia sozinho (a cada 5s, log em `server-restart.log`) se `kds-server.exe` encerrar com erro, em vez de pausar esperando input.
- `SQL2014_START_FROM_NOW` foi removido: sem `SQL2014_INITIAL_SYNC_AT` configurado, a sincronização sempre inicia pelo horário atual do próprio SQL Server (`GETDATE()`), nunca reimportando histórico antigo — independente do relógio/fuso da máquina onde o backend roda.

### Corrigido
- Cursor de sincronização (`lastSyncAt`) deixou de ser calculado com `useUTC=true` (padrão do driver mssql), que deslocava o cursor pelo fuso horário local e podia bloquear pedidos novos por horas em clientes no Brasil.
- Detecção leve de mudanças (`SQL2014_CHANGE_TOKEN_ENABLED`) deixou de rodar a query pesada em todo ciclo ocioso — o caso "sem mudanças" (mais comum) agora é distinguido corretamente de "erro/config ruim".

### Adicionado
- Mais índices de performance no SQL2014 do cliente (colunas de junção usadas pela query, conferidas contra o schema real): `Lançamentos.Cliente`, `Lançamentos.Integradora`, `Pedidos_Produtos.Lancamento`, `Pedidos_Produtos.Pedido`, `Pedidos_Produtos.Produto`.
- `SQL2014_REQUEST_TIMEOUT_MS`/`SQL2014_CONNECTION_TIMEOUT_MS` (padrão 30s) para bancos de cliente mais lentos.

## [2.0.4] - 2026-04-22

### Corrigido
- Persistencia de sons reforcada no frontend e backend: defaults validos, migracao de caminho legado e fallback consistente ao iniciar.
- Relatorios operacionais: removida coluna "Pedidos produzidos" para reduzir poluicao visual no painel e nas exportacoes.
- Exportacao PDF do relatorio redesenhada com identidade FOX KDS, cabecalho visual, bordas arredondadas e nome do restaurante.

### Alterado
- Versao do app atualizada para `2.0.4` e sincronizada com `src/lib/version.ts`.

## [2.0.3] - 2026-04-22

### Corrigido
- Bridge SQL: proteção anti-replay ao reiniciar com banco zerado — `lastSyncAt` é forçado para o momento atual quando `idMap` está vazio, impedindo reimportação de pedidos históricos.
- Bridge SQL: pedidos removidos do MongoDB não ressurgem mais — ao detectar UUID divergente no `idMap`, o novo pedido é deletado imediatamente e o `externalId` bloqueado (`stale_mapping_resurrection_blocked`).
- Permissão de relatórios (`reports`) agora é corretamente verificada em todas as camadas: backend retorna 403 quando não autorizado, menu e painel são ocultados no frontend.

### Segurança
- Senha mínima reduzida de 6 para 4 caracteres (backend e frontend).
- Nome de usuário `admin` (qualquer capitalização) agora é reservado — tentativa de criação ou edição retorna erro `username_reserved`.

### Infra
- `release/start-bridge.cmd` agora prefere executar o script JS diretamente (`node sql2014-kds-bridge.js`) antes de cair no binário `.exe`, garantindo que correções recentes sejam sempre aplicadas.

## [2.0.2] - 2026-04-16

### Adicionado
- Aba de Sons dentro de Configuracoes > Tema, com selecao de arquivos MP3 do sistema, caminho customizado, upload e teste de audio.
- Novos assets de som em `public/Songs`, incluindo alertas para novo pedido e pedido pronto.

### Corrigido
- Fluxo de pedidos em maquinas lentas com deduplicacao defensiva no frontend e idempotencia no backend via `externalId`.
- Nome do cliente no painel publico limitado para evitar invasao visual entre cards, com quebra de linha controlada.
- Persistencia imediata das configuracoes de som para manter a ultima selecao do cliente sem reconfiguracao manual.

### Alterado
- Padrao inicial de som de novo pedido atualizado para usar arquivo publico do sistema.
- Ajustes de imagens de login e organizacao de assets antigos no diretorio `public`.
- Inicializacao do `start-kds.js` com logs dedicados e bootstrap mais previsivel entre servidor e bridge SQL.

### Infra
- Vite passou a expor proxy para `/Songs` no ambiente local.
- Versao do app atualizada para `2.0.2` e sincronizada com `src/lib/version.ts`.

## [2.0.1] - 2026-04-15

### Corrigido
- Script `scripts/update-version.js` ajustado para ESM, garantindo sincronizacao automatica da versao sem erro em projetos com `"type": "module"`.

### Alterado
- Rebrand consolidado para FOX KDS na descricao de versao exibida no frontend (`src/lib/version.ts`).

### Infra
- Adicionado ignore de arquivos de runtime do bridge SQL (`server/scripts/.sql2014-bridge.pid` e `server/scripts/.sql2014-bridge-state.json`) para evitar sujeira em release.

## [2.0.0] - 2025-04-15

### Adicionado
- Nome do vendedor no card da cozinha para modalidades Mesa, Cartão e Apartamento
- Botão "Efeitos Visuais" na aba Tema para ativar/desativar piscar nos cards atrasados
- Filtro de modalidades no painel público (Mesa e Cartão não aparecem mais)
- Expansão do número do pedido no painel quando sem cliente identificado
- Setores ativáveis/desativáveis na configuração de Modalidades

### Corrigido
- JOIN SQL para buscar nome do vendedor corretamente via tabela PEDIDOS
- Painel público não mostra mais "Cliente não identificado" quando vazio
- Query SQL usa coluna [Lançamento] em vez de [Código] para vincular pedidos

### Changed
- Versão migrada para Semantic Versioning (SemVer)
- AdminPage mostra "Cliente não identificado" quando não há cliente
- PublicDisplayPage oculta cliente quando não identificado

## [1.0.0] - 2024 (Legado)

### Funcionalidades
- Sistema KDS completo com sincronização SQL Server 2014
- Painel de cozinha com controle de status
- Painel público de retirada
- Administração de pedidos
- Configurações de timer e sons
- Suporte a múltiplos setores
- Impressão de tickets
