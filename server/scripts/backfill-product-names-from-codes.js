require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const sql = require('mssql');
const Order = require('../models/Order');

const CODE_NAME_REGEX = /^Produto\s+(\d+)$/i;

function getSqlConfig() {
  return {
    server: process.env.SQL2014_HOST || '127.0.0.1',
    port: Number(process.env.SQL2014_PORT || 1433),
    user: process.env.SQL2014_USER,
    password: process.env.SQL2014_PASSWORD,
    database: process.env.SQL2014_DATABASE,
    options: {
      encrypt: String(process.env.SQL2014_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.SQL2014_TRUST_CERT || 'true').toLowerCase() !== 'false',
      enableArithAbort: true,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

async function loadProductNames(pool, productIds) {
  if (!productIds.length) return new Map();

  const request = pool.request();
  const placeholders = [];

  productIds.forEach((id, idx) => {
    const param = `p${idx}`;
    request.input(param, sql.VarChar(50), id);
    placeholders.push(`@${param}`);
  });

  const query = `
    SELECT
      CAST(vp.ProdutoID AS VARCHAR(50)) AS produtoId,
      COALESCE(
        NULLIF(LTRIM(RTRIM(vp.ProdutoApelido)), ''),
        NULLIF(LTRIM(RTRIM(vp.ProdutoNome)), '')
      ) AS produtoNome
    FROM vwProdutos vp
    WHERE CAST(vp.ProdutoID AS VARCHAR(50)) IN (${placeholders.join(', ')})
  `;

  const result = await request.query(query);
  const map = new Map();

  for (const row of result.recordset || []) {
    const id = String(row.produtoId || '').trim();
    const name = String(row.produtoNome || '').trim();
    if (id && name) map.set(id, name);
  }

  return map;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const orders = await Order.find({
    'items.name': { $regex: /^Produto\s+\d+$/i },
  }).lean();

  if (!orders.length) {
    console.log('Nenhum pedido com nome em formato Produto X encontrado.');
    await mongoose.disconnect();
    return;
  }

  const productIds = new Set();
  for (const order of orders) {
    for (const item of order.items || []) {
      const match = String(item.name || '').match(CODE_NAME_REGEX);
      if (match) productIds.add(match[1]);
    }
  }

  const sqlPool = await sql.connect(getSqlConfig());
  const nameMap = await loadProductNames(sqlPool, Array.from(productIds));

  let updatedOrders = 0;
  let updatedItems = 0;

  for (const order of orders) {
    let changed = false;
    const nextItems = (order.items || []).map((item) => {
      const match = String(item.name || '').match(CODE_NAME_REGEX);
      if (!match) return item;

      const productId = match[1];
      const resolvedName = nameMap.get(productId);
      if (!resolvedName) return item;

      changed = true;
      updatedItems += 1;
      return { ...item, name: resolvedName };
    });

    if (!changed) continue;

    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          items: nextItems,
          updatedAt: Date.now(),
        },
      }
    );

    updatedOrders += 1;
  }

  console.log(`Pedidos analisados: ${orders.length}`);
  console.log(`Pedidos atualizados: ${updatedOrders}`);
  console.log(`Itens renomeados: ${updatedItems}`);
  console.log(`Codigos sem nome encontrado: ${Array.from(productIds).filter((id) => !nameMap.has(id)).length}`);

  await sqlPool.close();
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try { await mongoose.disconnect(); } catch {}
  try { await sql.close(); } catch {}
  process.exit(1);
});
