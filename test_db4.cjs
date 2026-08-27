const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  for (let c of collections) {
    const data = await db.collection(c.name).find({ $or: [
      { name: /Magic Chess/i },
      { 'skus.name': /Magic Chess/i }
    ]}).toArray();
    if (data.length > 0) {
      console.log(`Found in collection ${c.name}`);
      console.log(JSON.stringify(data[0], null, 2));
    }
  }
  process.exit(0);
}
run();
