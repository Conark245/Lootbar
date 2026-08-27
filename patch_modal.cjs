const fs = require('fs');

let ui = fs.readFileSync('src/App_v2.tsx', 'utf8');

// We need to fix the SKU ID and Name mapping.
// Search for: const skuId = String(skuModalGame.isTpn ? sku.sku : sku.sku_id);

const targetBlock = `
                  return filteredSkus.map((sku: any) => {
                    const skuId = String(skuModalGame.isTpn ? sku.sku : sku.sku_id);
                    const name = skuModalGame.isTpn ? sku.name : (sku.sku_name || \`Package #\${skuId}\`);
                    const price = skuModalGame.isTpn 
                      ? \`\${sku.price} \${sku.currency || 'USD'}\` 
                      : \`$\${sku.reseller_price || sku.price || '0.00'}\`;
`;

const replaceBlock = `
                  return filteredSkus.map((sku: any) => {
                    const isApiBased = skuModalGame.isTpn || skuModalGame.isFzr;
                    const skuId = String(isApiBased ? sku.sku : sku.sku_id);
                    const name = isApiBased ? sku.name : (sku.sku_name || \`Package #\${skuId}\`);
                    const price = isApiBased 
                      ? \`$\${sku.price} \${sku.currency || 'USD'}\` 
                      : \`$\${sku.reseller_price || sku.price || '0.00'}\`;
`;

if (ui.includes('const skuId = String(skuModalGame.isTpn ? sku.sku : sku.sku_id);')) {
  ui = ui.replace(targetBlock, replaceBlock);
  fs.writeFileSync('src/App_v2.tsx', ui);
  console.log('patched sku properties');
} else {
  console.log('could not find target block');
}
