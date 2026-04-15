SELECT
  CAST(l.LancamentoID AS VARCHAR(100)) AS externalId,
  CAST(
    CASE
      WHEN l.Atendimento IS NOT NULL AND l.Atendimento <> 0
        THEN l.Atendimento
      ELSE ABS(CAST(l.LancamentoID AS BIGINT)) % 1000
    END
  AS INT) AS number,
  CASE
    WHEN l.ClienteID IS NULL OR l.ClienteID = 0 THEN ''
    WHEN NULLIF(LTRIM(RTRIM(c.Nome)), '') IS NULL THEN ''
    WHEN LOWER(LTRIM(RTRIM(c.Nome))) = 'geral' THEN ''
    ELSE LTRIM(RTRIM(c.Nome))
  END AS customerName,
  COALESCE(l.Memorando, '') AS observations,
  CAST(l.Status AS VARCHAR(20)) AS status,
  CAST(pp.Status AS VARCHAR(20)) AS itemStatus,
  CAST(l.Tipo AS VARCHAR(10)) AS serviceMode,
  CAST(l.Atendimento AS INT) AS attendantNumber,
  NULLIF(LTRIM(RTRIM(f.Nome)), '') AS sellerName,
  CAST(
    CASE
      WHEN COALESCE(l.Edicao, l.Inclusao, l.Movimento, l.Emissao) > COALESCE(pp.Edicao, pp.Inclusao, '1900-01-01')
      THEN COALESCE(l.Edicao, l.Inclusao, l.Movimento, l.Emissao)
      ELSE COALESCE(pp.Edicao, pp.Inclusao, l.Edicao, l.Inclusao, l.Movimento, l.Emissao)
    END
  AS DATETIME2) AS updatedAt,
  COALESCE(NULLIF(vp.ProdutoApelido, ''), NULLIF(vp.ProdutoNome, ''), NULLIF(pp.ProdutoDescricao, ''), CONCAT('Produto ', CAST(pp.ProdutoID AS VARCHAR(30)))) AS itemName,
  CAST(CASE WHEN pp.QDE IS NULL OR pp.QDE <= 0 THEN 1 ELSE pp.QDE END AS INT) AS itemQuantity,
  COALESCE(pp.Observacoes, '') AS itemNotes,
  COALESCE(CAST(pp.SetorID AS VARCHAR(20)), '') AS sectorId,
  CAST(pp.SubItem AS INT) AS subItem
FROM vwLancamentos l
INNER JOIN vwPedidosProdutos pp ON pp.LancamentoID = l.LancamentoID
LEFT JOIN PEDIDOS p ON p.[Lançamento] = l.LancamentoID
LEFT JOIN Clientes c ON c.[Código] = l.ClienteID
LEFT JOIN Fornecedores f ON f.[Código] = p.[Vendedor]
LEFT JOIN vwProdutos vp ON vp.ProdutoID = pp.ProdutoID
WHERE (
  COALESCE(pp.Edicao, pp.Inclusao) > @lastSyncAt
  OR COALESCE(l.Edicao, l.Inclusao, l.Movimento, l.Emissao) > @lastSyncAt
)
ORDER BY updatedAt ASC, l.LancamentoID ASC, pp.Item ASC, pp.SubItem ASC;
