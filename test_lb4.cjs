const fetch = require('node-fetch');
async function run() {
  const url = 'http://localhost:3000/api/games';
  const res = await fetch(url);
  const json = await res.json();
  const items = json?.data?.items || [];
  console.log("Found games:", items.length);
  const matches = items.filter(g => (g.name || g.game_name || '').toLowerCase().includes('magic'));
  console.log("Games with 'magic':", JSON.stringify(matches.map(m => m.name || m.game_name), null, 2));
}
run();
