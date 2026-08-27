const mongoose = require('mongoose');
const { LootbarClient } = require('./dist/server.cjs') || {};
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  
  // Find Lootbar config
  const AppConfig = mongoose.model('AppConfig', new mongoose.Schema({}, { strict: false }));
  const conf = await AppConfig.findOne({ key: 'lootbar_credentials' });
  const credentials = conf ? conf.get('value') : null;
  console.log("Credentials found:", !!credentials);
  
  process.exit(0);
}
run();
