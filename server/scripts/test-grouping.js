// Script simples para testar agrupamento sem API
const sql = require('mssql');
require('dotenv').config({ path: '../.env' });

async function test() {
  const sqlConfig = {
    server: process.env.SQL2014_HOST || '127.0.0.1',
    port: Number(process.env.SQL2014_PORT || 1433),
    user: process.env.SQL2014_USER,
    password: process.env.SQL2014_PASSWORD,
    database: process.env.SQL2014_DATABASE,
    options: { encrypt: false, trustServerCertificate: true }
  };

  const pool = new sql.ConnectionPool(sqlConfig);
  await pool.connect();

  // Carrega a query
  const fs = require('fs');
  const queryText = fs.readFileSync('./sql2014-lançamentos-query.sql', 'utf8');

  // Executa com data recente
  const request = pool.request();
  request.input('lastSyncAt', sql.DateTime2, new Date('2026-04-20'));

  const result = await request.query(queryText);
  const rows = result.recordset || [];

  console.log(`\n📊 Total de linhas retornadas: ${rows.length}`);

  // Agrupa manualmente para contar
  const grouped = new Map();
  for (const row of rows) {
    const launchCode = row.launchCode || row.externalId;
    if (!grouped.has(launchCode)) {
      grouped.set(launchCode, 0);
    }
    grouped.set(launchCode, grouped.get(launchCode) + 1);
  }

  console.log(`📋 Total de lançamentos únicos (launchCode): ${grouped.size}`);
  console.log(`\n🔍 Primeiros 10 lançamentos:`);
  let i = 0;
  for (const [code, count] of grouped) {
    if (i < 10) {
      console.log(`   ${code}: ${count} linhas`);
      i++;
    }
  }

  await pool.close();
  console.log('\n✅ Teste concluído!');
}

test().catch(err => console.error(err));
