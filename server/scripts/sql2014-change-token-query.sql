-- Query leve para detectar mudancas sem executar a query completa.
-- Deve retornar 1 linha com 1 coluna representando o ultimo instante de alteracao.
-- Ajuste os campos/tabelas conforme seu banco SQL2014.
--
-- IMPORTANTE: evite COALESCE(...) > @lastSyncAt no WHERE. O SQL Server nao consegue usar
-- indice em cima de uma expressao COALESCE (nao e sargable), entao essa comparacao forcava
-- um Clustered Index Scan (leitura da tabela inteira) em Pedidos_Produtos a cada poll,
-- rodando o tempo todo (a cada poucos segundos) mesmo sem nenhuma mudanca no banco -- isso
-- e o que deixava o disco do SQL Server em 100% continuamente. A versao abaixo compara cada
-- coluna isoladamente (sargable) e usa UNION ALL para combinar os resultados, permitindo que
-- o otimizador use Index Seek (com os indices criados por ensurePerformanceIndexes) em vez de
-- varrer a tabela inteira. Confirmado via SET SHOWPLAN_TEXT: a versao antiga gerava um
-- Clustered Index Scan; esta gera Index Seek + TOP(1) em cada coluna.
SELECT MAX(v) AS changeToken FROM (
  SELECT MAX(pp.Edicao) AS v FROM vwPedidosProdutos pp WHERE pp.Edicao > @lastSyncAt
  UNION ALL
  SELECT MAX(pp.Inclusao) AS v FROM vwPedidosProdutos pp WHERE pp.Edicao IS NULL AND pp.Inclusao > @lastSyncAt
  UNION ALL
  SELECT MAX(l.Edicao) AS v FROM vwLancamentos l WHERE l.Edicao > @lastSyncAt
  UNION ALL
  SELECT MAX(l.Inclusao) AS v FROM vwLancamentos l WHERE l.Edicao IS NULL AND l.Inclusao > @lastSyncAt
  UNION ALL
  SELECT MAX(l.Emissao) AS v FROM vwLancamentos l WHERE l.Edicao IS NULL AND l.Inclusao IS NULL AND l.Emissao > @lastSyncAt
) x;
