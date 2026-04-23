# KDS Bridge - Estrutura de Lançamentos

## Visão Geral
O Bridge SQL2014 foi refatorado para **separar pedidos pelo Código/PedidoID dentro do Lançamento**. O `LançamentoID` representa a mesa/cartão aberta, e cada `PedidoID` dentro dele gera uma **comanda independente** no KDS.

## Estrutura de Dados

### Antes (Problema)
```
Mesa 01
├── Item A (15:00)
├── Item B (15:00)
└── Item C (16:30)  ← Misturado! Setor não sabe que é lote diferente
```

### Depois (Solução)
```
Mesa 01 - Pedido #100 (15:00)
├── Item A
└── Item B

Mesa 01 - Pedido #101 (16:30)
└── Item C  ← Claro! Novo lote de produção
```

## Query SQL Refatorada

**Arquivo:** `sql2014-lançamentos-query.sql`

Principais mudanças:
- **launchCode** (PedidoID) → Identificador único da comanda
- **externalId** → Igual ao PedidoID (compatibilidade com bridge)
- **pedidoCodigo** → Código do pedido da origem
- **lancamentoId** → LancamentoID da mesa/cartão (contexto)
- **tipoAtendimento** → Tipo (mesa, cartão, delivery, etc)
- **setor** → SetorID dos produtos
- **sellerName** → Nome do vendedor/garçom

Cada linha traz:
- 1 Pedido dentro do lançamento
- 1 Produto (item)
- N linhas = N produtos de um pedido

## Bridge - Como Funciona

### Fluxo de Sincronização

1. **Query executa** → Retorna linhas agrupadas por PedidoID + Produtos
2. **groupRowsToOrders()** → Agrupa por `launchCode` (PedidoID)
3. **demandId** → Construído como `PedidoID::ISO8601_timestamp`
4. **Cada demanda** → Representa uma comanda no KDS
5. **createOrderInKds()** → Envia para API `/orders` com `demandId`

### Mapeamento de Campos

| SQL Campo | Bridge Campo | KDS Campo | Descrição |
|-----------|--------------|-----------|-----------|
| PedidoID | launchCode → externalId | externalId | Identificador único do pedido |
| Código (Pedido) | pedidoCodigo | - | Referência do pedido na origem |
| LancamentoID | lancamentoId | - | Mesa/cartão ao qual o pedido pertence |
| Vendedor | sellerName | sellerName | Garçom/Vendedor |
| Tipo | tipoAtendimento → serviceMode | serviceMode | mesa/cartão/delivery |
| Item + Status | itemStatus | status | Status do produto |
| QDE | itemQuantity | qty | Quantidade |
| SetorID | sectorId | sectorId | Setor de preparo |

## Configuração

### No `.env` (ou release/.env)
```bash
# Aponta para a nova query de Lançamentos
SQL2014_QUERY_FILE=./sql2014-lançamentos-query.sql

# Demais configurações
SQL2014_HOST=127.0.0.1
SQL2014_PORT=1433
SQL2014_USER=sa
SQL2014_PASSWORD=sisco12!@
SQL2014_DATABASE=BD_ZERADO_SINCRONIZADO-FEV2026
SQL2014_POLL_INTERVAL_MS=3000
SQL2014_START_FROM_NOW=true
```

## KDS Frontend - Como Renderizar

No `OrderContext` ou `KitchenPage`:

```typescript
// Agrupar por demandId (que é launchCode::timestamp)
const groupedByDemand = orders.reduce((acc, order) => {
  const demand = order.demandId || order.externalId;
  if (!acc[demand]) acc[demand] = [];
  acc[demand].push(order);
  return acc;
}, {});

// Renderizar cada demanda como uma comanda separada
Object.values(groupedByDemand).forEach(demand => {
  // Card com: Número da mesa, Lançamento, Tempo, Itens
});
```

## Troubleshooting

### Problema: Pedidos não chegam
1. Verificar `.sql2014-bridge-state.json` → `blockedExternalIds`
2. Verificar logs: `[sql2014-bridge] query retornou X linhas`
3. Verificar se `SQL2014_QUERY_FILE` aponta para `sql2014-lançamentos-query.sql`

### Problema: Dois lançamentos aparecem como um
1. Verificar se `demandId` está sendo gerado corretamente
2. Verificar se timestamps (`updatedAt`) são diferentes para cada lançamento
3. Logs: `[sql2014-bridge] pedido: sellerName=..., attendant=..., serviceMode=...`

### Problema: Setores errados ou itens faltando
1. Verificar se `sectorId` vem preenchido na query
2. Verificar se `SubItem > 0` (insumos) estão sendo ignorados corretamente
3. Verificar se `itemQuantity` (QTDE) está > 0

## Migrando de Queries Antigas

Se você estava usando `sql2014-gerencialbrunoinfo-query.sql`:

**Opção 1:** Atualizar `.env` para apontar para nova query
```bash
SQL2014_QUERY_FILE=./sql2014-lançamentos-query.sql
```

**Opção 2:** Copiar estrutura da nova query e adaptar seus campos
- Use `sql2014-lançamentos-query.sql` como template
- Adapte JOINs para suas tabelas
- Mapeie campos corretamente em `launchCode`, `externalId`, `pedidoCodigo`, `lancamento`

## Logs Esperados

Ao iniciar o bridge com a nova query:
```
[sql2014-bridge] executando query com lastSyncAt=...
[sql2014-bridge] query retornou 42 linhas
[sql2014-bridge] agrupado em 5 pedidos
[sql2014-bridge] pedido LANÇAMENTO-123: sellerName=João, attendant=5, serviceMode=mesa
[sql2014-bridge] pedido criado com demandId=LANÇAMENTO-123::2026-04-22T15:17:00.000Z
```

## Referências

- Bridge: `server/scripts/sql2014-kds-bridge.js`
- Query: `server/scripts/sql2014-lançamentos-query.sql`
- Estado: `server/scripts/.sql2014-bridge-state.json`
- API: `server/index.js` → `/orders` endpoint
