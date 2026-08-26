import fs from 'fs';

let bot = fs.readFileSync('server/bot.ts', 'utf8');

// For Lootbar: add skuShortKeys lookup at the beginning of findSkuMatch
bot = bot.replace(
  'function findSkuMatch(skus: any[], rawQuery: string): any {',
  `function findSkuMatch(skus: any[], rawQuery: string, skuShortKeys?: Record<string, string>): any {
  if (!rawQuery || !skus || skus.length === 0) return null;
  const query = rawQuery.trim().toLowerCase();
  
  if (skuShortKeys) {
    for (const [skuId, shortKey] of Object.entries(skuShortKeys)) {
      if (shortKey.toLowerCase() === query) {
        const match = skus.find(s => String(s.sku_id) === skuId);
        if (match) return match;
      }
    }
  }
`
);

// We need to pass skuShortKeys to findSkuMatch in handleGameDirectOrder
bot = bot.replace(
  'const selectedSku = findSkuMatch(skus, packageQuery);',
  'const selectedSku = findSkuMatch(skus, packageQuery, game.skuShortKeys instanceof Map ? Object.fromEntries(game.skuShortKeys) : game.skuShortKeys);'
);

// For TopupNation: add skuShortKeys lookup to findTopupNationSkuMatch
bot = bot.replace(
  'function findTopupNationSkuMatch(skus: any[], rawQuery: string): any {',
  `function findTopupNationSkuMatch(skus: any[], rawQuery: string, skuShortKeys?: Record<string, string>): any {
  if (!rawQuery || !skus || skus.length === 0) return null;
  const query = rawQuery.trim().toLowerCase();
  
  if (skuShortKeys) {
    for (const [skuId, shortKey] of Object.entries(skuShortKeys)) {
      if (shortKey.toLowerCase() === query) {
        const match = skus.find(s => String(s.sku) === skuId);
        if (match) return match;
      }
    }
  }
`
);

// We need to pass skuShortKeys to findTopupNationSkuMatch in handleTopupNationDirectOrder
bot = bot.replace(
  'const selectedSku = findTopupNationSkuMatch(skus, packageQuery);',
  'const selectedSku = findTopupNationSkuMatch(skus, packageQuery, tpnProduct.skuShortKeys instanceof Map ? Object.fromEntries(tpnProduct.skuShortKeys) : tpnProduct.skuShortKeys);'
);

fs.writeFileSync('server/bot.ts', bot);
console.log("bot.ts matching updated");
