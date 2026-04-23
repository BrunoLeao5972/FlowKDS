require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const orders = await Order.find({
    'items.name': { $regex: /^Produto\s+\d+/i },
  })
    .select('id externalId demandId number status items.name createdAt')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  console.log('ordersWithCodeName=', orders.length);

  for (const order of orders) {
    const names = (order.items || [])
      .map((item) => item.name)
      .filter((name) => /^Produto\s+\d+/i.test(name));

    console.log({
      id: order.id,
      externalId: order.externalId,
      demandId: order.demandId,
      number: order.number,
      status: order.status,
      names,
    });
  }

  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
