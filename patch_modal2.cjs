const fs = require('fs');
let ui = fs.readFileSync('src/App_v2.tsx', 'utf8');

// Fix the header badge
ui = ui.replace(
  "{skuModalGame.isTpn ? 'TopupNation' : 'LootBar'}",
  "{skuModalGame.isTpn ? 'TopupNation' : skuModalGame.isFzr ? 'FZR Cards' : 'LootBar'}"
);

// Fix the icon
ui = ui.replace(
  "{skuModalGame.isTpn ? '🌐' : '🎮'}",
  "{skuModalGame.isTpn ? '🌐' : skuModalGame.isFzr ? '💎' : '🎮'}"
);

// Fix colors for badge
const targetBadgeClass = `
                    ? 'bg-indigo-100 text-indigo-700' 
                    : 'bg-emerald-100 text-emerald-700'
`;
const replaceBadgeClass = `
                    ? 'bg-indigo-100 text-indigo-700' 
                    : skuModalGame.isFzr ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'
`;
ui = ui.replace(targetBadgeClass, replaceBadgeClass);

const targetBadgeClass2 = `
                        ? 'bg-indigo-100 text-indigo-800' 
                        : 'bg-emerald-100 text-emerald-800'
`;
const replaceBadgeClass2 = `
                        ? 'bg-indigo-100 text-indigo-800' 
                        : skuModalGame.isFzr ? 'bg-sky-100 text-sky-800' : 'bg-emerald-100 text-emerald-800'
`;
ui = ui.replace(targetBadgeClass2, replaceBadgeClass2);

// Fix game ID
ui = ui.replace(
  "ID: {skuModalGame.isTpn ? skuModalGame.productId : skuModalGame.gameId}",
  "ID: {skuModalGame.isTpn || skuModalGame.isFzr ? skuModalGame.productId : skuModalGame.gameId}"
);

// Fix short key calculation
ui = ui.replace(
  "Game Short Key: <strong className=\"text-neutral-800 font-bold\">.{skuModalGame.shortKey || (skuModalGame.isTpn ? `t${skuModalGame.productId.slice(0, 4)}` : skuModalGame.gameId)}</strong>",
  "Game Short Key: <strong className=\"text-neutral-800 font-bold\">.{skuModalGame.shortKey || (skuModalGame.isTpn ? `t${skuModalGame.productId.slice(0, 4)}` : skuModalGame.isFzr ? `f${skuModalGame.productId.slice(0, 4)}` : skuModalGame.gameId)}</strong>"
);

// Fix activeGameKey
ui = ui.replace(
  "const activeGameKey = skuModalGame.shortKey || (skuModalGame.isTpn ? `t${skuModalGame.productId.slice(0, 4)}` : skuModalGame.gameId);",
  "const activeGameKey = skuModalGame.shortKey || (skuModalGame.isTpn ? `t${skuModalGame.productId.slice(0, 4)}` : skuModalGame.isFzr ? `f${skuModalGame.productId.slice(0, 4)}` : skuModalGame.gameId);"
);

// Fix filter block
const filterBlockTarget = `
                    const name = String(skuModalGame.isTpn ? sku.name : (sku.sku_name || '')).toLowerCase();
                    const id = String(skuModalGame.isTpn ? sku.sku : sku.sku_id).toLowerCase();
`;
const filterBlockReplace = `
                    const isApiBased = skuModalGame.isTpn || skuModalGame.isFzr;
                    const name = String(isApiBased ? sku.name : (sku.sku_name || '')).toLowerCase();
                    const id = String(isApiBased ? sku.sku : sku.sku_id).toLowerCase();
`;
ui = ui.replace(filterBlockTarget, filterBlockReplace);

fs.writeFileSync('src/App_v2.tsx', ui);
console.log('patched more modal things');
