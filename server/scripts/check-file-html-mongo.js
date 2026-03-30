require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kds');
  await client.connect();
  const db = client.db();

  const rows = await db.collection('orders')
    .find({ 'items.notes': { $regex: 'FILE:|HTML:', $options: 'i' } })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();

  console.log('MONGO_MATCHES', rows.length);
  for (const r of rows) {
    console.log(`ORDER ${r.number} ${r.id}`);
    for (const it of r.items || []) {
      if (it.notes && /FILE:|HTML:/i.test(it.notes)) {
        console.log(` - ${it.name} => ${it.notes}`);
      }
    }
  }

  await client.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
