# Guia de Instalacao do Sistema (Flow KDS)

Este guia cobre a instalacao completa em um novo PC (Windows), incluindo:
- frontend + backend
- MongoDB
- integracao SQL Server 2014
- impressao automatica de senha de pedido
- ajustes do arquivo `.env`

## 1. Pre-requisitos

Instale no PC:
- Node.js 18+ (recomendado 20+)
- npm (vem com Node.js)
- MongoDB Community Server (local) OU MongoDB Atlas
- (Opcional) SQL Server 2014 acessivel na rede/local
- (Opcional) impressora ja instalada no Windows

Verificacao rapida:

```powershell
node -v
npm -v
```

## 2. Clonar o repositorio

```powershell
git clone <URL_DO_REPOSITORIO>
cd "Flow KDS"
```

## 3. Instalar dependencias

Na raiz:

```powershell
npm install
```

No backend:

```powershell
cd server
npm install
cd ..
```

## 4. Criar e configurar o arquivo de ambiente

Copie o exemplo:

```powershell
Copy-Item .\server\.env.example .\server\.env
```

Edite `server/.env`.

### 4.1 Configuracao minima (obrigatoria)

```env
PORT=8081
HOST=0.0.0.0
MONGODB_URI=mongodb://127.0.0.1:27017/kds
CORS_ORIGIN=*

AUTH_ENABLED=true
AUTH_USERNAME=Admin
AUTH_PASSWORD=masterkey
AUTH_TOKEN_SECRET=trocar-para-uma-chave-forte
AUTH_TOKEN_TTL_HOURS=12
```

## 5. Configurar MongoDB

### Opcao A: Mongo local

Use no `.env`:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/kds
```

Confirme se o servico esta rodando:

```powershell
Get-Service MongoDB,MongoDBServer,mongod -ErrorAction SilentlyContinue
```

Se estiver parado:

```powershell
Start-Service MongoDB
```

### Opcao B: MongoDB Atlas

Use no `.env`:

```env
MONGODB_URI=mongodb+srv://USUARIO:SENHA@CLUSTER.mongodb.net/kds?retryWrites=true&w=majority&appName=KDS
```

## 6. Testar conexao do banco antes de iniciar

```powershell
cd server
npm run test:db
```

Esperado: mensagem de conexao OK.

## 7. Subir o sistema

### Opcao 1 (recomendada): subir tudo junto

Na raiz:

```powershell
npm run start:all
```

### Opcao 2: subir separado

Terminal 1 (backend):

```powershell
cd server
npm start
```

Terminal 2 (frontend dev, se necessario):

```powershell
npm run dev
```

## 8. Integracao SQL Server 2014

A sincronizacao com o SQL2014 roda dentro do proprio backend (nao existe mais um processo/exe
separado para isso) — basta configurar as variaveis abaixo e subir o backend normalmente.

No `server/.env`, configure:

```env
SQL2014_HOST=127.0.0.1
SQL2014_PORT=1433
SQL2014_USER=sa
SQL2014_PASSWORD=sua_senha
SQL2014_DATABASE=NomeDoBanco
SQL2014_ENCRYPT=false
SQL2014_TRUST_CERT=true
SQL2014_POLL_INTERVAL_MS=3000
SQL2014_IDLE_POLL_INTERVAL_MS=3000
SQL2014_CHANGE_TOKEN_ENABLED=true
SQL2014_CHANGE_TOKEN_QUERY_FILE=./sql2014-change-token-query.sql
SQL2014_STATE_FILE=.sql2014-bridge-state.json
SQL2014_QUERY_FILE=./sql2014-gerencialbrunoinfo-query.sql
SQL2014_STATUS_MODE=parity

KDS_API_BASE=http://127.0.0.1:8081
KDS_AUTH_USERNAME=Admin
KDS_AUTH_PASSWORD=masterkey
```

Sem arquivo de estado, a sincronizacao sempre inicia pelo horario atual do proprio SQL Server do cliente (consulta `GETDATE()`), nunca reimportando historico antigo. Para forcar reprocessamento manual a partir de uma data especifica, defina `SQL2014_INITIAL_SYNC_AT` (formato ISO, ex.: `2026-03-28T00:00:00.000Z`) — uso raro, so quando for realmente necessario.

`SQL2014_CHANGE_TOKEN_ENABLED=true` ativa uma consulta leve de mudanca antes da consulta pesada. Se nao houver alteracao, o backend pula o ciclo pesado e reduz consumo de CPU.

### Excluir produtos que nao sao de cozinha (Servico, Taxa, Fabricacao, Grade, etc.)

`SQL2014_EXCLUDED_PRODUCT_TYPES` (lista separada por virgula) exclui itens do KDS pelo codigo de `Produtos.Tipo` (coluna `productType` na query). `Tipo` e um codigo de 1 letra fixo do proprio sistema do caixa (nao e configuravel por cliente), entao o mapeamento abaixo — confirmado criando um produto de teste pra cada tipo e conferindo o codigo gravado — vale para qualquer instalacao:

| Codigo | Significado |
|---|---|
| `A` | Taxa Adicional |
| `B` | Beneficiamento |
| `D` | Grade |
| `F` | Fabricacao |
| `G` | Taxa de Entrega |
| `M` | Evento |
| `Q` | Equivalente |
| `R` | Perda |
| `T` | Patrimonio |
| `U` | Clube de Consumo |
| `X` | Taxa de Servico |
| `P` | Produto normal (NAO excluir) |

Padrao no `.env.example`:

```env
SQL2014_EXCLUDED_PRODUCT_TYPES=A,B,D,F,G,M,Q,R,T,U,X
```

Servico e Material de Expediente nao tem codigo `Tipo` proprio nesse sistema (produtos de teste com esses nomes vieram gravados como `Tipo=P`, igual produto normal) — por isso ficam de fora da lista acima e continuam indo pro KDS normalmente.

Se precisar redescobrir os codigos em outra instalacao (ex.: outro sistema de caixa, nao so validar), rode:

```sql
SELECT Tipo, COUNT(*) AS Qtde, MIN(Descrição) AS ExemploNome
FROM Produtos
GROUP BY Tipo
ORDER BY Tipo;
```

### Trocar apenas o banco consultado

Altere somente:

```env
SQL2014_DATABASE=OutroBanco
```

Se o schema for diferente, ajuste tambem `SQL2014_QUERY_FILE`.

### Sobre UDL

- UDL ajuda a testar conexao SQL no Windows.
- O projeto Node nao le arquivo UDL diretamente.
- Use UDL so para validar conexao, depois copie host/porta/user/senha/banco para `server/.env`.

## 9. Impressao automatica de senha

No `server/.env`:

```env
PRINT_PEDIDO_AUTO_ENABLED=true
PRINT_PEDIDO_MODO=FILE
PRINT_PEDIDO_IMPRESSORA=
PRINT_PEDIDO_OUTPUT_DIR=C:\\Projetos\\Flow KDS\\server\\prints
```

Valores de `PRINT_PEDIDO_MODO`:
- `IMPRESSORA`: imprime direto na impressora do Windows
- `FILE`: gera `.txt` e abre no Bloco de Notas
- `HTML`: gera `.html` e abre no navegador padrao

Para impressao direta, informe:

```env
PRINT_PEDIDO_MODO=IMPRESSORA
PRINT_PEDIDO_IMPRESSORA=Nome Exato da Impressora no Windows
```

## 10. Validacao final (checklist)

1. `npm run test:db` em `server` retorna OK
2. Backend sobe na porta `8081`
3. Backend conecta no SQL2014 (`connected to SQL Server`)
4. Novo pedido aparece no KDS
5. Cancelamento no caixa reflete no KDS
6. Impressao automatica dispara no modo configurado

## 11. Troubleshooting rapido

### Erro: "Failed to start server" / Mongo nao conecta

- Verifique se `server/.env` existe
- Verifique `MONGODB_URI`
- Teste com `npm run test:db`
- Verifique servico Mongo no Windows (`Get-Service MongoDB...`)

### Erro: porta 8081 em uso

```powershell
Get-NetTCPConnection -LocalPort 8081 | Select-Object OwningProcess
Get-Process -Id <PID>
```

Pare processo antigo e reinicie.

### Impressora nao encontrada

- Confirme nome exato da impressora no Windows
- Teste em modo `FILE` para validar fluxo
- Depois volte para `IMPRESSORA`

## 12. Arquivos principais para configuracao

- `server/.env`
- `server/.env.example`
- `server/scripts/sql2014-gerencialbrunoinfo-query.sql`
- `server/scripts/.sql2014-bridge-state.json`
- `server/services/pedidoPrinter.js`

## 13. Distribuicao protegida (sem expor codigo-fonte)

Para entregar ao cliente local sem enviar o fonte completo, use o pipeline de release:

```powershell
npm run release:protected
```

Isso gera a pasta `release/` com:
- `kds-server.exe` (backend empacotado, ja inclui a sincronizacao com o SQL2014)
- `dist/` (frontend compilado)
- `scripts/*.sql` (queries do SQL2014)
- `.env.example`
- `start-server.cmd`, `start-all.cmd` (rodar manualmente, com janela visivel)
- `nssm.exe`, `install-service.cmd`, `uninstall-service.cmd` (rodar como Servico do Windows, recomendado)

Passos no cliente:
1. Copiar apenas a pasta `release/`.
2. Criar `.env` a partir de `.env.example` na raiz da pasta `release`.
3. Ajustar variaveis do ambiente (`MONGODB_URI`, SQL2014_*, etc.).
4. Iniciar (ver opcoes abaixo).

#### Opcao recomendada: instalar como Servico do Windows

Sem janela visivel no PC do cliente, inicia sozinho no boot (mesmo sem ninguem logado) e reinicia sozinho se cair:

1. Clique com o botao direito em `install-service.cmd` -> "Executar como administrador" (ou de um PowerShell/cmd elevado).
2. O script cria o `.env` a partir do `.env.example` se ainda nao existir (edite antes de continuar) e registra o servico `FOX KDS Server`.
3. Confira em `services.msc` -> "FOX KDS Server". Logs em `release\logs\service-out.log` / `service-err.log`.
4. Para atualizar de versao: pare o servico (`uninstall-service.cmd` ou pelo `services.msc`), substitua os arquivos da pasta pela nova versao e rode `install-service.cmd` de novo (e idempotente — reinstala por cima sem duplicar).
5. Para remover: `uninstall-service.cmd` (tambem como administrador).

Usa o [NSSM](https://nssm.cc) (dominio publico) para registrar o `kds-server.exe` como servico, ja que um `.exe` comum nao sabe se comunicar com o Gerenciador de Servicos do Windows sozinho.

#### Opcao alternativa: rodar manualmente (janela visivel)

Util para debug/primeira configuracao — mostra o console em tempo real:

```powershell
start-all.cmd
```

Se o `.env` nao existir, `start-server.cmd` cria automaticamente o arquivo a partir de `.env.example` e mostra instrucoes. Se `kds-server.exe` encerrar com erro, `start-server.cmd` reinicia sozinho a cada 5s (log em `server-restart.log`).

### EXE abre e fecha na hora (release)

A causa mais comum e configuracao ausente ou invalida no `.env`:
- `MONGODB_URI` ausente/invalido ou MongoDB desligado.
- `SQL2014_USER`, `SQL2014_PASSWORD` ou `SQL2014_DATABASE` ausentes (nesse caso a sincronizacao com o SQL2014 so fica desabilitada com um aviso no log — nao derruba o `kds-server.exe`).

Use `start-server.cmd` (nao clique direto no `.exe`) para ver a mensagem de erro e manter a janela aberta.

Observacoes de seguranca:
- Nao enviar pasta `src/`, `server/` e `.git` para cliente.
- O frontend ja sai minificado e sem source map no build de producao.
- Ainda assim, software local nunca e 100% inviolavel; esse fluxo apenas dificulta engenharia reversa.
