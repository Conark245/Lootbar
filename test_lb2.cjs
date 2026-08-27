const fetch = require('node-fetch'); // or use built in fetch in node 18+
async function run() {
  const url = 'http://localhost:3000/api/saved-games/5791/skus';
  const res = await fetch(url);
  const json = await res.json();
  console.log(JSON.stringify(json.data.slice(0, 3), null, 2));
}
run();
