# KDS Server

Servidor de API do KDS com persistencia em MongoDB.

Comandos

- Instalar dependências (na raiz do repositório):

```bash
cd server
npm install
```

- Configurar variaveis de ambiente:

```bash
cd server
cp .env.example .env
```

No Windows PowerShell, se `cp` nao funcionar:

```powershell
Copy-Item .env.example .env
```

Edite `MONGODB_URI` no `.env` para seu Mongo local ou MongoDB Atlas.

- Iniciar (produção/simple):

```bash
cd server
npm start
```

- Iniciar em modo desenvolvimento (se tiver `nodemon` globalmente):

```bash
cd server
npm run dev
```

- Iniciar com reload automatico:

```bash
cd server
npm run dev:watch
```

Porta

- Porta padrao da API e `8081`.
- Para alterar em tempo de execução, exporte `PORT` antes de iniciar:

```bash
# Windows (PowerShell)
$Env:PORT=1234; npm start

# Linux / macOS
PORT=1234 npm start
```

API (endpoints principais)

- `GET /orders` — lista todos os pedidos (JSON array).
- `POST /orders` — cria um pedido. Exemplo de payload:

```json
{
  "number": 201,
  "customerName": "Nome",
  "observations": "",
  "items": [{ "name": "X-Burger", "quantity": 2 }]
}
```

- `PATCH /orders/:id/status` — atualiza status. Exemplo:

```json
{ "status": "preparing" }
```

Integracao SQL Server 2014 (somente leitura)

Use este modo quando o sistema de caixa grava pedidos no SQL Server 2014 e o KDS precisa apenas espelhar os dados.

1. Instale a dependencia adicional no backend:

```bash
cd server
npm install
```

2. Configure as variaveis no `server/.env`:

- SQL Server: `SQL2014_HOST`, `SQL2014_PORT`, `SQL2014_USER`, `SQL2014_PASSWORD`, `SQL2014_DATABASE`
- Polling: `SQL2014_POLL_INTERVAL_MS`, `SQL2014_INITIAL_SYNC_AT`
- Consulta: `SQL2014_QUERY_FILE` (recomendado) ou `SQL2014_QUERY`
- KDS API: `KDS_API_BASE` + autenticacao (`KDS_AUTH_USERNAME`/`KDS_AUTH_PASSWORD` ou `KDS_AUTH_TOKEN`)

3. Copie o modelo de query e ajuste para seu banco do caixa:

```bash
cd server/scripts
cp sql2014-example-query.sql sql2014-query.sql
```

No Windows PowerShell, se `cp` nao funcionar:

```powershell
Copy-Item .\sql2014-example-query.sql .\sql2014-query.sql
```

Depois, no `.env`, aponte:

```env
SQL2014_QUERY_FILE=./sql2014-query.sql
```

Para o banco `GerencialBrunoInfo`, ja existe um modelo especifico pronto:

```env
SQL2014_QUERY_FILE=./sql2014-gerencialbrunoinfo-query.sql
SQL2014_STATUS_MODE=parity
```

Com `SQL2014_STATUS_MODE=parity`, codigos impares sao tratados como `cancelled` e codigos pares como `received`.
Se algum status tiver regra diferente, voce pode sobrescrever com `SQL2014_STATUS_MAP`.

4. Execute o conector:

```bash
cd server
npm run bridge:sql2014
```

Contrato da query

A consulta SQL deve retornar as colunas abaixo (com estes aliases):

- `externalId` (string): ID unico do pedido no caixa
- `number` (numero): numero do pedido
- `customerName` (string): nome do cliente (pode vazio)
- `observations` (string): observacoes (pode vazio)
- `status` (string): status no caixa (mapeado para KDS)
- `updatedAt` (datetime): data da ultima atualizacao no caixa
- `itemsJson` (json string): itens no formato array `[ { name, quantity, notes } ]`

Observacoes importantes

- O conector grava estado incremental em `SQL2014_STATE_FILE` para evitar duplicacao.
- O SQL do caixa e usado apenas para leitura.
- O KDS continua sendo a camada de exibicao/sincronizacao em tempo real (cozinha e display).

Banco de dados (MongoDB)

- URI padrao: `mongodb://127.0.0.1:27017/kds`
- Collection principal: `orders`
- Para usar Atlas, exemplo:

```text
MONGODB_URI=mongodb+srv://<usuario>:<senha>@<cluster>/<database>?retryWrites=true&w=majority
```

Persistencia de longo prazo (recomendado)

- Sempre defina `MONGODB_URI` explicitamente no ambiente. O servidor nao deve iniciar sem essa variavel.
- Para dados de cliente "para sempre", prefira MongoDB Atlas (ou outro Mongo gerenciado) em vez de banco local.
- Evite comandos de limpeza em producao (ex.: `deleteMany({})`).
- Ative backup automatico (snapshot diario) e mantenha retencao minima de 30 a 90 dias.
- Teste restore periodicamente em ambiente de homologacao.

Backup e restore (exemplo)

```bash
# Backup (gera dump compactado)
mongodump --uri="<MONGODB_URI>" --archive=backup-kds.archive --gzip

# Restore (restaura todos os dados)
mongorestore --uri="<MONGODB_URI>" --archive=backup-kds.archive --gzip --drop
```

Configurar MongoDB Atlas (passo a passo)

1. Crie um cluster no Atlas (plano free serve para comecar).
2. Em `Database Access`, crie um usuario de banco (ex.: `kds_app`).
3. Em `Network Access`, adicione seu IP atual ou `0.0.0.0/0` temporariamente para testes.
4. No cluster, clique em `Connect` > `Drivers` e copie a connection string.
5. Substitua placeholders na string:

```text
mongodb+srv://<usuario>:<senha>@<cluster>.mongodb.net/kds?retryWrites=true&w=majority&appName=KDS
```

6. Salve a URI em `server/.env`:

```env
MONGODB_URI=mongodb+srv://usuario:senha@cluster.mongodb.net/kds?retryWrites=true&w=majority&appName=KDS
```

7. Teste a conexao antes de subir a API:

```bash
cd server
npm run test:db
```

8. Se o teste passar, inicie o servidor:

```bash
cd server
npm run dev
```

Observacoes

- CORS está habilitado para permitir que o frontend em `localhost` acesse a API.
- No frontend, a variavel `VITE_API_BASE` pode apontar para `http://localhost:8081`.
- A especificacao OpenAPI esta em `server/openapi.yaml`.

Resetar dados

- Para limpar os pedidos no MongoDB local:

```javascript
// mongosh
use kds
db.orders.deleteMany({})
```

Proximos passos sugeridos

- Proteger/validar payloads no servidor.
- Adicionar endpoints para deletar/editar itens.
- Adicionar autenticacao de API para integracoes externas.
