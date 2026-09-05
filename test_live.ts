import mongoose from 'mongoose';
import { TopupNationService } from './server/providers/topupnation/TopupNationService';
import { TopupNationClient } from './server/providers/topupnation/TopupNationClient';

const client = new TopupNationClient({
  apiKey: process.env.TOPUPNATION_API_KEY || '',
  apiSecret: process.env.TOPUPNATION_API_SECRET || '',
  baseUrl: 'https://topupnation.io'
});

async function run() {
  try {
    const liveProduct = await client.getProduct('1'); // assuming '1' is MLBB
    console.log("Live product MLBB SKU 0:", liveProduct?.skus[0]);
  } catch (err) {
    console.error("Error fetching live product:", err.response?.data || err.message);
  }
}
run();
