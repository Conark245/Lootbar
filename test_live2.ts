import { TopupNationClient } from './server/providers/topupnation/TopupNationClient.ts';

const client = new TopupNationClient({
  apiKey: process.env.TOPUPNATION_API_KEY || '',
  apiSecret: process.env.TOPUPNATION_API_SECRET || '',
  baseUrl: 'https://topupnation.io'
});

async function run() {
  try {
    const list = await client.getProducts();
    const hpProduct = list.find(p => p.name.toLowerCase().includes('mobile legends') || String(p.productId) === '1');
    if (hpProduct) {
      console.log("From getProducts (ALL):", hpProduct.skus[0]);
      const single = await client.getProduct(hpProduct.productId);
      console.log("From getProduct (SINGLE):", single.skus[0]);
    } else {
      console.log("Product not found");
    }
  } catch(e) {
    console.error(e.message);
  }
}
run();
