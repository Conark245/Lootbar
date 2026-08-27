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
  const res = await client.request('GET', '/topups/offers');
  console.log('Keys:', Object.keys(res));
  console.log('Items length:', (res as any).offers?.length || (res as any).items?.length || (res as any).data?.length);
  process.exit(0);
}
run();
