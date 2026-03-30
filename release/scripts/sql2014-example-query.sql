SELECT
  CAST(p.IdPedido AS VARCHAR(100)) AS externalId,
  CAST(p.NumeroPedido AS INT) AS number,
  ISNULL(c.Nome, '') AS customerName,
  ISNULL(p.Observacoes, '') AS observations,
  CAST(p.Status AS VARCHAR(30)) AS status,
  CAST(p.DataAtualizacao AS DATETIME2) AS updatedAt,
  ISNULL(i.NomeItem, 'Item') AS itemName,
  CAST(CASE WHEN i.Quantidade IS NULL OR i.Quantidade <= 0 THEN 1 ELSE i.Quantidade END AS INT) AS itemQuantity,
  ISNULL(i.Observacao, '') AS itemNotes
FROM dbo.Pedidos p
LEFT JOIN dbo.ItensPedido i ON i.IdPedido = p.IdPedido
LEFT JOIN dbo.Clientes c ON c.IdCliente = p.IdCliente
WHERE p.DataAtualizacao > @lastSyncAt
ORDER BY p.DataAtualizacao ASC, p.IdPedido ASC;
