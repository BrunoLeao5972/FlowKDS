require('dotenv').config();
const sql = require('mssql');

async function run() {
  const pool = await sql.connect({
    server: process.env.SQL2014_HOST,
    port: Number(process.env.SQL2014_PORT),
    user: process.env.SQL2014_USER,
    password: process.env.SQL2014_PASSWORD,
    database: process.env.SQL2014_DATABASE,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true }
  });

  // Mostra os 10 lançamentos mais recentes com status e timestamps
  const r = await pool.request().query(`
    SELECT TOP 10
      l.LancamentoID,
      l.Status AS lStatus,
      l.Edicao AS lEdicao,
      l.Inclusao AS lInclusao,
      pp.Item,
      pp.Status AS ppStatus,
      pp.Edicao AS ppEdicao,
      pp.Inclusao AS ppInclusao
    FROM vwLancamentos l
    INNER JOIN vwPedidosProdutos pp ON pp.LancamentoID = l.LancamentoID
    ORDER BY COALESCE(l.Edicao, l.Inclusao) DESC, l.LancamentoID DESC
  `);

  console.log('=== Lançamentos recentes (por lEdicao DESC) ===');
  for (const row of r.recordset) {
    const lStatus = row.lStatus;
    const lParity = Math.abs(Number(lStatus)) % 2 === 1 ? 'CANCELADO' : 'OK';
    console.log(`LancID=${row.LancamentoID} lStatus=${lStatus}(${lParity}) lEdicao=${row.lEdicao ? row.lEdicao.toISOString() : 'NULL'} lInclusao=${row.lInclusao ? row.lInclusao.toISOString() : 'NULL'} | ppItem=${row.Item} ppStatus=${row.ppStatus} ppEdicao=${row.ppEdicao ? row.ppEdicao.toISOString() : 'NULL'}`);
  }

  // Verificar se há lançamentos com status ímpar (cancelados)
  const cancelled = await pool.request().query(`
    SELECT TOP 5
      l.LancamentoID,
      l.Status AS lStatus,
      l.Edicao AS lEdicao,
      l.Inclusao AS lInclusao
    FROM vwLancamentos l
    WHERE CAST(l.Status AS INT) % 2 <> 0
    ORDER BY COALESCE(l.Edicao, l.Inclusao) DESC
  `);
  console.log('\n=== Lançamentos cancelados (status ímpar) ===');
  for (const row of cancelled.recordset) {
    console.log(`LancID=${row.LancamentoID} lStatus=${row.lStatus} lEdicao=${row.lEdicao ? row.lEdicao.toISOString() : 'NULL'} lInclusao=${row.lInclusao ? row.lInclusao.toISOString() : 'NULL'}`);
  }

  await pool.close();
}
run().catch(e => console.error(e.message));
