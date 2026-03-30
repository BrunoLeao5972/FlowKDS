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

  const cols = await pool.request().query(`
    SELECT c.name
    FROM sys.columns c
    INNER JOIN sys.views v ON v.object_id = c.object_id
    WHERE v.name = 'vwPedidosProdutos'
    ORDER BY c.column_id
  `);

  const names = cols.recordset.map(r => r.name);
  console.log('Total colunas vwPedidosProdutos:', names.length);
  console.log('Colunas com obs/nota/coment:');
  for (const n of names) {
    const lower = n.toLowerCase();
    if (lower.includes('obs') || lower.includes('nota') || lower.includes('coment')) {
      console.log(' -', n);
    }
  }

  const sample = await pool.request().query(`
    SELECT TOP 20 *
    FROM vwPedidosProdutos
    ORDER BY COALESCE(Edicao, Inclusao) DESC
  `);

  const candidateCols = names.filter(n => {
    const lower = n.toLowerCase();
    return lower.includes('obs') || lower.includes('nota') || lower.includes('coment');
  });

  console.log('\nAmostra de valores (linhas recentes):');
  for (const row of sample.recordset) {
    const vals = candidateCols
      .map(c => ({ c, v: row[c] }))
      .filter(x => x.v !== null && x.v !== undefined && String(x.v).trim() !== '');
    if (vals.length > 0) {
      console.log('LancamentoID=', row.LancamentoID, 'Item=', row.Item, 'SubItem=', row.SubItem);
      for (const x of vals) {
        console.log(`   ${x.c}: ${String(x.v)}`);
      }
    }
  }

  await pool.close();
}

run().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
