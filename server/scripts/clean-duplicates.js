require('dotenv').config();
const { MongoClient } = require('mongodb');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kds';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const col = db.collection('orders');

  const orders = await col.find({}).sort({ createdAt: 1 }).toArray();
  console.log('Total orders:', orders.length);

  const seenExternalId = new Map();
  const toDelete = [];

  for (const o of orders) {
    const key = o.externalId || null;
    if (key) {
      if (seenExternalId.has(key)) {
        toDelete.push(o._id);
        console.log('Duplicate externalId:', key, '→ deleting _id:', o._id.toString());
      } else {
        seenExternalId.set(key, o._id);
      }
    }
  }

  console.log('Duplicates to delete:', toDelete.length);
  if (toDelete.length > 0) {
    const result = await col.deleteMany({ _id: { $in: toDelete } });
    console.log('Deleted:', result.deletedCount);
  } else {
    console.log('Nenhum duplicado encontrado.');
  }

  await client.close();
}
run().catch(console.error);
