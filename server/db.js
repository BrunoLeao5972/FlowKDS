const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, 'kds.json');

function read() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { orders: [] };
  }
}

function write(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  getOrders() {
    const db = read();
    return db.orders;
  },
  getOrder(id) {
    const db = read();
    return db.orders.find(o => o.id === id);
  },
  createOrder(order) {
    (read()).orders.push(order);
    write(read());
    return order;
  },
  updateOrder(id, patch) {
    const db = read();
    const idx = db.orders.findIndex(o => o.id === id);
    if (idx === -1) return null;
    db.orders[idx] = { ...db.orders[idx], ...patch };
    write(db);
    return db.orders[idx];
  }
  ,
  deleteOrder(id) {
    const db = read();
    const idx = db.orders.findIndex(o => o.id === id);
    if (idx === -1) return false;
    db.orders.splice(idx, 1);
    write(db);
    return true;
  }
};
