# Release 2.0.1 - 2026-04-15

## Resumo
Release de estabilizacao para fechamento de ciclo apos as mudancas recentes no FOX KDS, com foco em consistencia de versionamento e higiene de artefatos de runtime.

## Versoes
- App version: 2.0.1
- Frontend package: 2.0.1
- Server package: 10.4.26 (sem alteracao nesta release)

## Principais Entregas

### 1. Versionamento confiavel em ambiente ESM
- Correcao do script `scripts/update-version.js` para funcionar com `type: module`.
- Sincronizacao da versao com `src/lib/version.ts` validada em `2.0.1`.

Arquivos principais:
- scripts/update-version.js
- src/lib/version.ts
- package.json
- package-lock.json

### 2. Higiene de release para bridge SQL
- Inclusao de arquivos temporarios do bridge SQL no `.gitignore`.
- Evita inclusao acidental de PID e estado de execucao no controle de versao.

Arquivos principais:
- .gitignore

## Validacoes executadas
1. `npm run build` - OK
2. `npm run test` - OK
3. `npm run lint` - com problemas preexistentes no projeto (nao bloqueantes para build)

## Observacoes para Publicacao
- O lint atual retorna erros e warnings historicos em multiplos arquivos. A release foi validada por build e testes automatizados.
- Para distribuicao protegida ao cliente, usar `npm run release:protected`.

## Changelog Curto
- fix(release): corrige `update-version.js` para ESM
- chore(version): atualiza versao para 2.0.1
- chore(git): ignora arquivos de runtime do bridge SQL
