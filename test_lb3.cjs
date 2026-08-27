const fetch = require('node-fetch');
async function run() {
  const url = 'http://localhost:3000/api/games';
  const res = await fetch(url);
  const json = await res.json();
  const items = json?.data?.items || [];
  const mc = items.find(g => (g.name || g.game_name || '').toLowerCase().includes('magic chess'));
  console.log("Magic chess game info:", JSON.stringify(mc, null, 2));
  if (mc) {
    const gameId = mc.id || mc.game_id;
    console.log("Fetching SKUs for gameId:", gameId);
    const skuRes = await fetch(`http://localhost:3000/api/saved-games/${gameId}/skus`);
    const skuJson = await skuRes.json();
    console.log("SKUs:", JSON.stringify(skuJson.data.slice(0,3), null, 2));
  }
}
run();
