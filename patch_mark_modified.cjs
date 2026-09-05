const fs = require('fs');

const botPath = 'server/bot.ts';
let bot = fs.readFileSync(botPath, 'utf8');

if (bot.includes('product.skus = liveProduct.skus || [];')) {
  bot = bot.replace(
    'product.skus = liveProduct.skus || [];',
    "product.skus = liveProduct.skus || [];\\n        product.markModified('skus');\\n        product.markModified('fields');"
  );
  fs.writeFileSync(botPath, bot);
  console.log("Patched bot.ts");
}

const pollerPath = 'server/pricePoller.ts';
let poller = fs.readFileSync(pollerPath, 'utf8');

if (poller.includes('p.skus = liveMatch.skus || [];')) {
  poller = poller.replace(
    /p\.skus = liveMatch\.skus \|\| \[\];/g,
    "p.skus = liveMatch.skus || [];\\n          p.markModified('skus');\\n          p.markModified('fields');"
  );
  fs.writeFileSync(pollerPath, poller);
  console.log("Patched pricePoller.ts");
}
