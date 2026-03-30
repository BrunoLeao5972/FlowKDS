# Guia de Instalacao do Sistema (Flow KDS)

Este guia cobre a instalacao completa em um novo PC (Windows), incluindo:
- frontend + backend
- MongoDB
- integracao SQL Server 2014 (bridge)
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

Terminal 2 (bridge SQL, se usar):

```powershell
cd server
npm run bridge:sql2014
```

Terminal 3 (frontend dev, se necessario):

```powershell
npm run dev
```

## 8. Integracao SQL Server 2014 (bridge)

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
SQL2014_INITIAL_SYNC_AT=2026-03-28T00:00:00.000Z
SQL2014_STATE_FILE=.sql2014-bridge-state.json
SQL2014_QUERY_FILE=./sql2014-gerencialbrunoinfo-query.sql
SQL2014_STATUS_MODE=parity

KDS_API_BASE=http://127.0.0.1:8081
KDS_AUTH_USERNAME=Admin
KDS_AUTH_PASSWORD=masterkey
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
3. Bridge conecta no SQL (`connected to SQL Server`)
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

### Bridge nao inicia por lock

Apague lock antigo:

```powershell
Remove-Item .\server\scripts\.sql2014-bridge.pid -ErrorAction SilentlyContinue
```

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
