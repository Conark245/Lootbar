import mongoose from 'mongoose';
import fetch from 'node-fetch';
import 'dotenv/config';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  const AppConfig = mongoose.model('AppConfig', new mongoose.Schema({}, { strict: false }));
  const conf = await AppConfig.findOne({ key: 'fzrcards_credentials' });
  const apiKey = conf.get('value').apiKey;
  
  const res = await fetch(`https://api.fzr.cards/api/v2/topups/offers`, {
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' }
  });
  const data = await res.json();
  console.log('All offers response ok:', data.ok);
  console.log('Total items:', data.items ? data.items.length : (data.offers ? data.offers.length : 'N/A'));
  console.log('Data keys:', Object.keys(data));
  process.exit(0);
}
run();
