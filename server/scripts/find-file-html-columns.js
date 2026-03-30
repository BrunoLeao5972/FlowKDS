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
    SELECT v.name AS viewName, c.name AS columnName
    FROM sys.columns c
    INNER JOIN sys.views v ON v.object_id = c.object_id
    WHERE v.name IN ('vwPedidosProdutos', 'vwLancamentos')
      AND (
        LOWER(c.name) LIKE '%obs%'
        OR LOWER(c.name) LIKE '%nota%'
        OR LOWER(c.name) LIKE '%coment%'
        OR LOWER(c.name) LIKE '%html%'
        OR LOWER(c.name) LIKE '%file%'
        OR LOWER(c.name) LIKE '%xml%'
      )
    ORDER BY v.name, c.column_id
  `);

  for (const row of r.recordset) {
    console.log(`${row.viewName}.${row.columnName}`);
  }

  await pool.close();
}

run().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
