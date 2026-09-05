const fs = require('fs');
let poller = fs.readFileSync('server/pricePoller.ts', 'utf8');

// LOOTBAR
poller = poller.replace(
  /if \(oldPrice !== newPrice\) {[\s\S]*?changes\.push\(`• \${name}: \\\`\$[\s\S]*?\);[\s\S]*?}[\s\S]*?}/,
  `if (oldPrice !== newPrice) {
                  const name = (newSku.sku_name || newSku.name || 'Package').replace(/[*_\`\\[\\]]/g, '');
                  const indicator = newPrice > oldPrice ? '🔴 🔺' : '🟢 🔻';
                  changes.push(\`• \${name}: \\\`$\${oldPrice.toFixed(2)}\\\` ➔ \\\`$\${newPrice.toFixed(2)}\\\` \${indicator}\`);
                }
              } else {
                const newPrice = parseFloat(newSku.reseller_price || newSku.price || '0');
                const name = (newSku.sku_name || newSku.name || 'Package').replace(/[*_\`\\[\\]]/g, '');
                changes.push(\`• 🆕 \${name} (New): \\\`$\${newPrice.toFixed(2)}\\\`\`);
              }`
);

// TOPUPNATION (First replace inside checkTopupNationPrices)
poller = poller.replace(
  /if \(oldPrice !== newPrice\) {[\s\S]*?const indicator = newPrice > oldPrice \? '🔴 🔺' : '🟢 🔻';[\s\S]*?changes\.push\(`• \${name}: \\\`\$[\s\S]*?\);[\s\S]*?}[\s\S]*?}/,
  `if (oldPrice !== newPrice) {
                const name = (newSku.name || 'Package').replace(/[*_\`\\[\\]]/g, '');
                const indicator = newPrice > oldPrice ? '🔴 🔺' : '🟢 🔻';
                changes.push(\`• \${name}: \\\`$\${oldPrice.toFixed(2)}\\\` ➔ \\\`$\${newPrice.toFixed(2)}\\\` \${indicator}\`);
              }
            } else {
              const newPrice = parseFloat(String(newSku.price || '0'));
              const name = (newSku.name || 'Package').replace(/[*_\`\\[\\]]/g, '');
              changes.push(\`• 🆕 \${name} (New): \\\`$\${newPrice.toFixed(2)}\\\`\`);
            }`
);

// FZRCARDS (Second replace inside checkFzrCardsPrices)
poller = poller.replace(
  /if \(oldPrice !== newPrice\) {[\s\S]*?const indicator = newPrice > oldPrice \? '🔴 🔺' : '🟢 🔻';[\s\S]*?changes\.push\(`• \${name}: \\\`\$[\s\S]*?\);[\s\S]*?}[\s\S]*?}/,
  `if (oldPrice !== newPrice) {
                const name = (newSku.name || 'Package').replace(/[*_\`\\[\\]]/g, '');
                const indicator = newPrice > oldPrice ? '🔴 🔺' : '🟢 🔻';
                changes.push(\`• \${name}: \\\`$\${oldPrice.toFixed(2)}\\\` ➔ \\\`$\${newPrice.toFixed(2)}\\\` \${indicator}\`);
              }
            } else {
              const newPrice = parseFloat(String(newSku.price || '0'));
              const name = (newSku.name || 'Package').replace(/[*_\`\\[\\]]/g, '');
              changes.push(\`• 🆕 \${name} (New): \\\`$\${newPrice.toFixed(2)}\\\`\`);
            }`
);

fs.writeFileSync('server/pricePoller.ts', poller);
console.log("Patched New SKUs");
