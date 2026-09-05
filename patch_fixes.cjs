const fs = require('fs');

// Fix bot.ts
let bot = fs.readFileSync('server/bot.ts', 'utf8');
bot = bot.replace('const matchedTpn = tpnProducts.find((p: any) => {', 'let matchedTpn = tpnProducts.find((p: any) => {');
fs.writeFileSync('server/bot.ts', bot);

// Fix pricePoller.ts
let poller = fs.readFileSync('server/pricePoller.ts', 'utf8');
poller = poller.replace(/p\.skus = liveMatch\.skus \|\| \[\];\\n          p\.markModified\('skus'\);\\n          p\.markModified\('fields'\);/g, "p.skus = liveMatch.skus || [];\n          p.markModified('skus');\n          p.markModified('fields');");
fs.writeFileSync('server/pricePoller.ts', poller);
