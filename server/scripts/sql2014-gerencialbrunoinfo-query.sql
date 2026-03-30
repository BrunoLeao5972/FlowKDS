SELECT
  CAST(l.LancamentoID AS VARCHAR(100)) AS externalId,
  CAST(
    CASE
      WHEN l.Atendimento IS NOT NULL AND l.Atendimento <> 0
        THEN l.Atendimento
      ELSE ABS(CAST(l.LancamentoID AS BIGINT)) % 1000
    END
  AS INT) AS number,
  COALESCE(NULLIF(c.Nome, ''), 'Cliente sem cadastro') AS customerName,
  COALESCE(l.Memorando, '') AS observations,
  CAST(l.Status AS VARCHAR(20)) AS status,
  CAST(pp.Status AS VARCHAR(20)) AS itemStatus,
  CAST(
    CASE
      WHEN COALESCE(l.Edicao, l.Inclusao, l.Movimento, l.Emissao) > COALESCE(pp.Edicao, pp.Inclusao, '1900-01-01')
      THEN COALESCE(l.Edicao, l.Inclusao, l.Movimento, l.Emissao)
      ELSE COALESCE(pp.Edicao, pp.Inclusao, l.Edicao, l.Inclusao, l.Movimento, l.Emissao)
    END
  AS DATETIME2) AS updatedAt,
  COALESCE(NULLIF(vp.ProdutoApelido, ''), NULLIF(vp.ProdutoNome, ''), NULLIF(pp.ProdutoDescricao, ''), CONCAT('Produto ', CAST(pp.ProdutoID AS VARCHAR(30)))) AS itemName,
  CAST(CASE WHEN pp.QDE IS NULL OR pp.QDE <= 0 THEN 1 ELSE pp.QDE END AS INT) AS itemQuantity,
  COALESCE(pp.Observacoes, '') AS itemNotes
FROM vwLancamentos l
INNER JOIN vwPedidosProdutos pp ON pp.LancamentoID = l.LancamentoID
LEFT JOIN Clientes c ON c.[Código] = l.ClienteID
LEFT JOIN vwProdutos vp ON vp.ProdutoID = pp.ProdutoID
WHERE (
  COALESCE(pp.Edicao, pp.Inclusao) > @lastSyncAt
  OR COALESCE(l.Edicao, l.Inclusao, l.Movimento, l.Emissao) > @lastSyncAt
)
ORDER BY updatedAt ASC, l.LancamentoID ASC, pp.Item ASC, pp.SubItem ASC;
