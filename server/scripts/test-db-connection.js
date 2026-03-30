require('dotenv').config();
const mongoose = require('mongoose');

async function testConnection() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('MONGODB_URI nao definido no ambiente (.env).');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection.db;
    const ordersCount = await db.collection('orders').countDocuments({});

    console.log('Conexao MongoDB OK.');
    console.log(`Database: ${db.databaseName}`);
    console.log(`Collection orders: ${ordersCount} documentos`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Falha ao conectar no MongoDB.');
    console.error(error.message);
    process.exit(1);
  }
}

testConnection();
