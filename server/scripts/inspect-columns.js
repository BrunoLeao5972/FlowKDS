/**
 * Script para inspecionar colunas das tabelas vwLancamentos e vwPedidosProdutos
 */

const sql = require('mssql');
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

async function inspect() {
  let pool;
  try {
    pool = new sql.ConnectionPool(sqlConfig);
    await pool.connect();
    console.log('✓ Conectado\n');

    console.log('═══════════════════════════════════════════');
    console.log('COLUNAS DA TABELA vwLancamentos');
    console.log('═══════════════════════════════════════════\n');
    
    const r1 = await pool.request().query('SELECT TOP 1 * FROM vwLancamentos');
    if (r1.recordset.length > 0) {
      Object.keys(r1.recordset[0]).forEach(k => console.log('  ' + k));
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('COLUNAS DA TABELA vwPedidosProdutos');
    console.log('═══════════════════════════════════════════\n');
    
    const r2 = await pool.request().query('SELECT TOP 1 * FROM vwPedidosProdutos');
    if (r2.recordset.length > 0) {
      Object.keys(r2.recordset[0]).forEach(k => console.log('  ' + k));
    }

    console.log('\n✓ Pronto. Use os nomes acima para atualizar a query.\n');
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

inspect();
