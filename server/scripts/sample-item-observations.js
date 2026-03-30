require('dotenv').config();
const sql = require('mssql');

async function run() {
  const pool = await sql.connect({
    server: process.env.SQL2014_HOST,
    port: Number(process.env.SQL2014_PORT),
    user: process.env.SQL2014_USER,
    password: process.env.SQL2014_PASSWORD,
    database: process.env.SQL2014_DATABASE,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  });

  const r = await pool.request().query(`
    SELECT TOP 25
      l.LancamentoID,
      l.Status AS LancStatus,
      l.Edicao AS LancEdicao,
      pp.Item,
      pp.SubItem,
      pp.Observacoes
    FROM vwLancamentos l
    INNER JOIN vwPedidosProdutos pp ON pp.LancamentoID = l.LancamentoID
    WHERE pp.Observacoes IS NOT NULL
      AND LTRIM(RTRIM(pp.Observacoes)) <> ''
    ORDER BY COALESCE(pp.Edicao, pp.Inclusao, l.Edicao, l.Inclusao) DESC
  `);

  console.log('RECENT_ITEM_OBS', r.recordset.length);
  for (const row of r.recordset) {
    console.log(`${row.LancamentoID} item=${row.Item}/${row.SubItem} status=${row.LancStatus} obs=${String(row.Observacoes)}`);
  }

  await pool.close();
}

run().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
