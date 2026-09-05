const fs = require('fs');
let poller = fs.readFileSync('server/pricePoller.ts', 'utf8');

// The issue in LootBar
poller = poller.replace(
  /if \(oldPrice !== newPrice\) {[\s\S]*?changes\.push\(`• \${name}: \\\`\${oldPrice\.toFixed\(2\)}\\\` ➔ \\\`\${newPrice\.toFixed\(2\)}\\\` \${indicator}`\);[\s\S]*?}[\s\S]*?} else {[\s\S]*?changes\.push\(`• 🆕 \${name} \(New\): \\\`\${newPrice\.toFixed\(2\)}\\\``\);[\s\S]*?} else {[\s\S]*?changes\.push\(`• 🆕 \${name} \(New\): \\\`\${newPrice\.toFixed\(2\)}\\\``\);[\s\S]*?} else {[\s\S]*?changes\.push\(`• 🆕 \${name} \(New\): \\\`\${newPrice\.toFixed\(2\)}\\\``\);[\s\S]*?}/g,
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

// We need a more deterministic replace.
