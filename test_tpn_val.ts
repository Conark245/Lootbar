import { TopupNationClient } from './server/providers/topupnation/TopupNationClient.ts';
const client = new TopupNationClient({
  apiKey: process.env.TOPUPNATION_API_KEY || '',
  apiSecret: process.env.TOPUPNATION_API_SECRET || '',
  baseUrl: 'https://topupnation.io'
});
console.log("Checking client methods:", Object.getOwnPropertyNames(TopupNationClient.prototype));
