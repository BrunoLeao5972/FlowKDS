require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kds');
  await client.connect();
  const db = client.db();

  const rows = await db.collection('orders')
    .find({ 'items.notes': { $exists: true, $ne: '' } })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  console.log('Pedidos com observacao por item (ultimos 5):', rows.length);
  for (const r of rows) {
    console.log(`Pedido ${r.number} (${r.status})`);
    for (const item of r.items || []) {
      if (item.notes) {
        console.log(` - ${item.name}: ${item.notes}`);
      }
    }
  }

  await client.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
