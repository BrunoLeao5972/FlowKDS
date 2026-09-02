-- Query refatorada: Agrupa por PEDIDO dentro do mesmo LANÇAMENTO
-- Um LancamentoID representa a mesa/cartao; cada PedidoID dentro dele vira uma comanda no KDS
-- Produtos vêm de vwPedidosProdutos e são separados por PedidoID

SELECT
  -- Identificadores principais
  -- PedidoID e o lote real dentro da mesa/cartao.
  CAST(pp.PedidoID AS VARCHAR(100)) AS launchCode,
  CAST(pp.PedidoID AS VARCHAR(100)) AS externalId,
  CAST(l.LancamentoID AS VARCHAR(100)) AS lancamentoId,
  CAST(pp.PedidoID AS VARCHAR(100)) AS pedidoCodigo,
  
  -- Número do atendimento; delivery/encomenda têm Atendimento=0, usa PedidoID como fallback
  CAST(COALESCE(NULLIF(l.Atendimento, 0), pp.PedidoID) AS INT) AS number,
  
  -- Cliente
  CASE
    WHEN l.ClienteID IS NULL OR l.ClienteID = 0 THEN ''
    WHEN NULLIF(LTRIM(RTRIM(c.Nome)), '') IS NULL THEN ''
    WHEN LOWER(LTRIM(RTRIM(c.Nome))) = 'geral' THEN ''
    ELSE LTRIM(RTRIM(c.Nome))
  END AS customerName,
  
  -- Tipo de atendimento (mesa, cartão, delivery, etc)
  CAST(l.Tipo AS VARCHAR(20)) AS serviceMode,
  CAST(l.Tipo AS VARCHAR(20)) AS tipoAtendimento,
  
  -- Status do lançamento
  CAST(l.Status AS VARCHAR(20)) AS status,
  COALESCE(l.Memorando, '') AS observations,
  
  -- Vendedor (Garçom) - via pedido real do item
  NULLIF(LTRIM(RTRIM(f.Nome)), '') AS sellerName,
  
  -- Dados do Lançamento
  CAST(l.Atendimento AS INT) AS attendantNumber,
  CAST(l.Integradora AS VARCHAR(20)) AS integratorId,
  NULLIF(LTRIM(RTRIM(ig.IntegradoraNome)), '') AS integratorName,
  
  -- Produtos do Lançamento (de vwPedidosProdutos)
  CAST(pp.Item AS VARCHAR(20)) AS itemSequence,
  CAST(pp.ProdutoID AS VARCHAR(50)) AS produtoId,
  CAST(pp.QDE AS INT) AS itemQuantity,
  CAST(pp.QDE AS INT) AS QTDE,
  CAST(pp.SetorID AS VARCHAR(20)) AS sectorId,
  CAST(pp.SetorID AS VARCHAR(20)) AS setor,
  CAST(pp.Status AS VARCHAR(20)) AS itemStatus,
  CAST(pp.SubItem AS INT) AS subItem,
  COALESCE(pp.Observacoes, '') AS itemNotes,
  -- Tipo do produto (Produtos.Tipo, via vwProdutos.Tipo2): usado para excluir do KDS itens que
  -- nao sao comida/bebida de cozinha (ex.: Servico, Taxa de Entrega, Fabricacao, Grade...).
  -- Ver SQL2014_EXCLUDED_PRODUCT_TYPES no .env.
  CAST(vp.Tipo2 AS VARCHAR(20)) AS productType,
  
  -- Descrição do Produto: prioriza apelido/nome de vwProdutos, depois descrição do item.
  COALESCE(
    NULLIF(LTRIM(RTRIM(vp.ProdutoApelido)), ''),
    NULLIF(LTRIM(RTRIM(vp.ProdutoNome)), ''),
    NULLIF(LTRIM(RTRIM(pp.ProdutoDescricao)), ''),
    CAST('Produto ' + CAST(pp.ProdutoID AS VARCHAR(30)) AS VARCHAR(100))
  ) AS itemName,
  
  -- Data de atualização (para sincronização)
  CAST(
    CASE
      WHEN COALESCE(l.Edicao, l.Inclusao) > COALESCE(pp.Edicao, pp.Inclusao, '1900-01-01')
      THEN COALESCE(l.Edicao, l.Inclusao, l.Emissao)
      ELSE COALESCE(pp.Edicao, pp.Inclusao, l.Edicao, l.Inclusao, l.Emissao)
    END
  AS DATETIME2) AS updatedAt
  
FROM vwLancamentos l
INNER JOIN vwPedidosProdutos pp ON pp.LancamentoID = l.LancamentoID
LEFT JOIN Clientes c ON c.[Código] = l.ClienteID
LEFT JOIN PEDIDOS ped ON ped.[Código] = pp.PedidoID
LEFT JOIN Fornecedores f ON f.[Código] = ped.[Vendedor]
LEFT JOIN Integracao.Integradora ig ON ig.IntegradoraID = l.Integradora
  AND ISNUMERIC(CAST(ig.Status AS VARCHAR(50))) = 1
  AND ABS(CONVERT(BIGINT, ig.Status)) % 2 = 0
LEFT JOIN vwProdutos vp ON vp.ProdutoID = pp.ProdutoID

-- Sargable: COALESCE(...) > @lastSyncAt impede o uso de indice (forca Clustered Index Scan
-- da tabela inteira a cada execucao). Decomposto em comparacoes diretas por coluna para
-- permitir Index Seek nos indices de DataDeEdição criados por ensurePerformanceIndexes.
WHERE (
  pp.Edicao > @lastSyncAt
  OR (pp.Edicao IS NULL AND pp.Inclusao > @lastSyncAt)
  OR l.Edicao > @lastSyncAt
  OR (l.Edicao IS NULL AND l.Inclusao > @lastSyncAt)
  OR (l.Edicao IS NULL AND l.Inclusao IS NULL AND l.Emissao > @lastSyncAt)
)

ORDER BY 
  updatedAt ASC, 
  pp.PedidoID ASC,
  pp.Item ASC, 
  pp.SubItem ASC;
