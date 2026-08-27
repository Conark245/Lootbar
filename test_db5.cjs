const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  for (let c of collections) {
    const data = await db.collection(c.name).find({ 'skus.price': 0.1813 }).toArray();
    if (data.length > 0) {
      console.log(`Found price 0.1813 in collection ${c.name}`);
      console.log(JSON.stringify(data[0], null, 2));
    }
    
    // Also try checking reseller_price for lootbar
    const lbData = await db.collection(c.name).find({ 'lastKnownSkus.reseller_price': "0.1813" }).toArray();
    if (lbData.length > 0) {
      console.log(`Found reseller_price 0.1813 in collection ${c.name}`);
    }
  }
  process.exit(0);
}
run();
