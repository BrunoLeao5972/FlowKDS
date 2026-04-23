const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const cfg = {
  user: process.env.SQL2014_USER, password: process.env.SQL2014_PASSWORD,
  server: process.env.SQL2014_HOST, database: process.env.SQL2014_DATABASE,
  port: Number(process.env.SQL2014_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true }
};

sql.connect(cfg).then(async pool => {
  const r = await pool.request().query(`
    SELECT pp.Status, COUNT(*) as cnt
    FROM vwPedidosProdutos pp
    GROUP BY pp.Status
    ORDER BY cnt DESC
  `);
  console.log('Distinct itemStatus values:');
  console.log(JSON.stringify(r.recordset, null, 2));

  const r2 = await pool.request().query(`
    SELECT l.Status, COUNT(*) as cnt
    FROM vwLancamentos l
    GROUP BY l.Status
    ORDER BY cnt DESC
  `);
  console.log('\nDistinct launch Status values:');
  console.log(JSON.stringify(r2.recordset, null, 2));

  await pool.close();
}).catch(e => console.error(e.message));
