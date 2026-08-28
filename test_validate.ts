import { TopupNationClient } from './server/providers/topupnation/TopupNationClient.ts';
const client = new TopupNationClient({
  apiKey: process.env.TOPUPNATION_API_KEY || '',
  apiSecret: process.env.TOPUPNATION_API_SECRET || '',
  baseUrl: 'https://topupnation.io'
});
async function run() {
  try {
    const res = await client['request']('GET', '/api/v1/reseller/products/1/validate?userAccount=123');
    console.log(res);
  } catch (e) {
    console.error(e.message);
  }
}
run();
