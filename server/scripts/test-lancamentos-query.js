/**
 * Script de Teste: Nova Query de Lançamentos
 * 
 * Uso: node test-lancamentos-query.js
 * 
 * Testa:
 * - Conexão com SQL Server
 * - Execução da query sql2014-lançamentos-query.sql
 * - Estrutura de retorno
 * - Agrupamento por Lançamento
 */

const sql = require('mssql');
const fs = require('fs/promises');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sqlConfig = {
  server: process.env.SQL2014_HOST || '127.0.0.1',
  port: Number(process.env.SQL2014_PORT || 1433),
  user: process.env.SQL2014_USER || 'sa',
  password: process.env.SQL2014_PASSWORD || '',
  database: process.env.SQL2014_DATABASE || '',
  options: {
    encrypt: process.env.SQL2014_ENCRYPT === 'true',
    trustServerCertificate: process.env.SQL2014_TRUST_CERT !== 'false',
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

async function testLancamentosQuery() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Teste: Query de Lançamentos');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📋 Configuração SQL:');
  console.log(`  Server: ${sqlConfig.server}:${sqlConfig.port}`);
  console.log(`  Database: ${sqlConfig.database}`);
  console.log(`  User: ${sqlConfig.user}`);
  console.log('');

  let pool;
  try {
    console.log('🔌 Conectando ao SQL Server...');
    pool = new sql.ConnectionPool(sqlConfig);
    await pool.connect();
    console.log('✓ Conexão estabelecida!\n');

    console.log('📂 Carregando query SQL...');
    const queryPath = path.join(__dirname, 'sql2014-lançamentos-query.sql');
    const queryText = await fs.readFile(queryPath, 'utf8');
    console.log(`✓ Query carregada (${queryText.length} caracteres)\n`);

    console.log('⏳ Executando query...');
    const request = pool.request();
    request.input('lastSyncAt', sql.DateTime2, new Date('2026-01-01'));
    
    const result = await request.query(queryText);
    const rows = result.recordset || [];

    console.log(`✓ Query executada: ${rows.length} linhas retornadas\n`);

    if (rows.length === 0) {
      console.log('⚠️  Nenhuma linha retornada. Isso pode estar correto se:');
      console.log('   - Não há lançamentos após 2026-01-01');
      console.log('   - SQL_START_FROM_NOW=true no .env\n');
      console.log('Tente alterar a data em test-lancamentos-query.js:');
      console.log('   request.input("lastSyncAt", sql.DateTime2, new Date("2024-01-01"));\n');
    } else {
      console.log('📊 Estrutura de dados:\n');
      
      // Agrupar por launchCode/externalId
      const grouped = {};
      rows.forEach(r => {
        const key = r.launchcode || r.externalId;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
      });

      console.log(`Total de Lançamentos (demandas): ${Object.keys(grouped).length}`);
      console.log(`Total de Produtos: ${rows.length}\n`);

      // Mostrar primeiros 3 lançamentos
      const lancamentos = Object.entries(grouped).slice(0, 3);
      
      lancamentos.forEach(([launchCode, items], idx) => {
        console.log(`📌 Lançamento #${idx + 1}: ${launchCode}`);
        const first = items[0];
        console.log(`   Número (Mesa/Cartão): ${first.number}`);
        console.log(`   Tipo: ${first.tipoatendimento || first.servicemode || 'N/A'}`);
        console.log(`   Vendedor: ${first.sellername || 'N/A'}`);
        console.log(`   Cliente: ${first.customername || 'Não identificado'}`);
        console.log(`   Status: ${first.status}`);
        console.log(`   Atualizado em: ${first.updatedat}`);
        console.log(`   Produtos:`);
        
        items.forEach((item, pidx) => {
          console.log(`     ${pidx + 1}. ${item.itemname}`);
          console.log(`        QDE: ${item.itemquantity || item.qtde}`);
          console.log(`        Setor: ${item.setorid || item.setor || 'N/A'}`);
          console.log(`        Status: ${item.itemstatus || 'N/A'}`);
        });
        console.log('');
      });

      // Verificar campos obrigatórios
      console.log('✓ Verificação de campos obrigatórios:');
      const firstRow = rows[0];
      const requiredFields = [
        'launchcode',
        'externalid',
        'number',
        'tipoatendimento',
        'itemname',
        'itemquantity',
        'updatedat',
      ];

      const allFieldsLower = Object.keys(firstRow).map(k => k.toLowerCase());
      const missingFields = requiredFields.filter(f => !allFieldsLower.includes(f));

      if (missingFields.length === 0) {
        console.log('  ✓ Todos os campos obrigatórios estão presentes\n');
      } else {
        console.log(`  ⚠️  Campos faltantes: ${missingFields.join(', ')}\n`);
      }

      // Verificar se há múltiplos lançamentos na mesma mesa
      const mesaGroups = {};
      rows.forEach(r => {
        const mesa = r.number;
        if (!mesaGroups[mesa]) mesaGroups[mesa] = new Set();
        mesaGroups[mesa].add(r.launchcode || r.externalid);
      });

      console.log('📊 Análise de Mesas:');
      const mesasComMultiplosLancamentos = Object.entries(mesaGroups)
        .filter(([, launches]) => launches.size > 1)
        .slice(0, 3);

      if (mesasComMultiplosLancamentos.length > 0) {
        console.log(`  ✓ Encontradas mesas com múltiplos lançamentos:`);
        mesasComMultiplosLancamentos.forEach(([mesa, launches]) => {
          console.log(`    Mesa/Cartão ${mesa}: ${launches.size} lançamentos`);
          Array.from(launches).forEach((launch, idx) => {
            console.log(`      ${idx + 1}. ${launch}`);
          });
        });
      } else {
        console.log('  ℹ️  Não há múltiplos lançamentos na mesma mesa nos dados retornados');
      }
    }

    console.log('\n✅ Teste concluído com sucesso!\n');
    console.log('Próximos passos:');
    console.log('  1. Verificar se dados estão corretos acima');
    console.log('  2. Iniciar o bridge: npm run start:bridge');
    console.log('  3. Monitorar logs: [sql2014-bridge] agrupado em X pedidos\n');

  } catch (error) {
    console.error('❌ Erro durante o teste:\n');
    console.error(error.message);
    if (error.originalError) {
      console.error('Detalhes:', error.originalError.message);
    }
    process.exit(1);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

testLancamentosQuery();
