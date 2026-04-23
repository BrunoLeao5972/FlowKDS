/**
 * Script para ver dados brutos da query de Lançamentos
 */

const sql = require('mssql');
const fs = require('fs/promises');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sqlConfig = {
  server: process.env.SQL2014_HOST || '127.0.0.1',
  port: parseInt(process.env.SQL2014_PORT || '1433', 10),
  user: process.env.SQL2014_USER || 'sa',
  password: process.env.SQL2014_PASSWORD || '',
  database: process.env.SQL2014_DATABASE || '',
  options: {
    encrypt: process.env.SQL2014_ENCRYPT === 'true',
    trustServerCertificate: process.env.SQL2014_TRUST_CERT !== 'false',
    enableArithAbort: true,
  },
};

async function showRawData() {
  let pool;
  try {
    pool = new sql.ConnectionPool(sqlConfig);
    await pool.connect();
    console.log('✓ Conectado\n');

    const queryPath = path.join(__dirname, 'sql2014-lançamentos-query.sql');
    const queryText = await fs.readFile(queryPath, 'utf8');

    const request = pool.request();
    request.input('lastSyncAt', sql.DateTime2, new Date('2026-01-01'));
    
    const result = await request.query(queryText);
    const rows = result.recordset || [];

    console.log(`Retornou ${rows.length} linhas\n`);

    if (rows.length > 0) {
      console.log('═══════════════════════════════════════════');
      console.log('PRIMEIROS 3 REGISTROS (RAW)');
      console.log('═══════════════════════════════════════════\n');
      
      rows.slice(0, 3).forEach((row, idx) => {
        console.log(`Registro ${idx + 1}:`);
        console.log(JSON.stringify(row, null, 2));
        console.log('');
      });
    }

    console.log('✓ Pronto\n');
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

showRawData();
