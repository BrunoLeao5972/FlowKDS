-- Query leve para detectar mudancas sem executar a query completa.
-- Deve retornar 1 linha com 1 coluna representando o ultimo instante de alteracao.
-- Ajuste os campos/tabelas conforme seu banco SQL2014.

SELECT
  CONVERT(VARCHAR(33), MAX(COALESCE(pp.Edicao, pp.Inclusao, l.Edicao, l.Inclusao, l.Emissao)), 126) AS changeToken
FROM vwPedidosProdutos pp
INNER JOIN vwLancamentos l ON l.LancamentoID = pp.LancamentoID
WHERE COALESCE(pp.Edicao, pp.Inclusao, l.Edicao, l.Inclusao, l.Emissao) > @lastSyncAt;
