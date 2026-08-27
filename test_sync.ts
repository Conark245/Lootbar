import mongoose from 'mongoose';
import { FzrCardsClient } from './server/providers/fzrcards/FzrCardsClient.js';
import { FzrCardsService } from './server/providers/fzrcards/FzrCardsService.js';
import 'dotenv/config';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-studio-dev');
  const AppConfig = mongoose.model('AppConfig', new mongoose.Schema({}, { strict: false }));
  const conf = await AppConfig.findOne({ key: 'fzrcards_credentials' });
  const apiKey = conf ? conf.get('value').apiKey : process.env.FZRCARDS_API_KEY;
  
  const client = new FzrCardsClient({ apiKey, baseUrl: 'https://api.fzr.cards' });
  const service = new FzrCardsService(client);
  
  const start = Date.now();
  const res = await service.syncProducts();
  const end = Date.now();
  console.log('Sync finished in', (end - start) / 1000, 'seconds');
  console.log('Result:', res);
  process.exit(0);
}
run();
