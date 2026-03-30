const mongoose = require('mongoose');

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required. Configure it in server/.env before starting the API.');
  }

  // Em produção, evita sincronização automática de índices na inicialização.
  if (process.env.NODE_ENV === 'production') {
    mongoose.set('autoIndex', false);
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });

  console.log(`MongoDB connected (${mongoose.connection.host}/${mongoose.connection.name})`);
}

module.exports = { connectMongo };
