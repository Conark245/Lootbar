const fs = require('fs');
const botPath = 'server/bot.ts';
let bot = fs.readFileSync(botPath, 'utf8');

const syncFunctionStart = `async function syncTopupNationProductLive(product: any, shortKey: string) {`;
const syncFunctionNew = `async function syncTopupNationProductLive(product: any, shortKey: string) {
    if (!topupNation || !topupNation.getClient()?.isConfigured()) return product;
    try {
      const liveProduct = await topupNation.getClient().getProduct(product.productId);
      if (liveProduct && liveProduct.skus && liveProduct.skus.length > 0) {
        const changes: string[] = [];
        // Compare SKUs
        for (const newSku of liveProduct.skus) {
          const oldSku = (product.skus || []).find((s: any) => String(s.sku) === String(newSku.sku));
          if (oldSku) {
            const oldPrice = parseFloat(String(oldSku.price || '0'));
            const newPrice = parseFloat(String(newSku.price || '0'));
            if (oldPrice !== newPrice) {
              const name = (newSku.name || 'Package').replace(/[*_\`\\[\\]]/g, '');
              const indicator = newPrice > oldPrice ? '🔴 🔺' : '🟢 🔻';
              changes.push(\`• \${name}: \\\`$\${oldPrice.toFixed(2)}\\\` ➔ \\\`$\${newPrice.toFixed(2)}\\\` \${indicator}\`);
            }
          }
        }

        // Update DB with latest data
        product.name = liveProduct.name;
        product.status = liveProduct.status || 'ACTIVE';
        product.category = liveProduct.category;
        product.description = liveProduct.description;
        product.iconUrl = liveProduct.iconUrl;
        product.fields = liveProduct.fields || [];
        product.skus = liveProduct.skus || [];
        product.markModified('skus');
        product.markModified('fields');
        await product.save();

        if (changes.length > 0) {
          const users = await User.find({ isAuthorized: true });
          const message = \`📈 *Price Update Alert* (TopupNation)\\n\` +
            \`🎮 Game: *\${(product.name || 'Game').replace(/[*_\`\\[\\]]/g, '')}* (\\\`.\${shortKey}\\\`)\\n\\n\` +
            \`The following packages have updated prices:\\n\` +
            changes.join('\\n') +
            \`\\n\\n_Note: The Bot has already updated its prices automatically. You will see these new prices when placing an order._\`;
          for (const u of users) {
            try {
              await bot.telegram.sendMessage(u.telegramChatId, message, { parse_mode: 'Markdown' });
              await new Promise(resolve => setTimeout(resolve, 50));
            } catch (e) {}
          }
        }
        
        return product; // Return the updated product
      }
    } catch (err) {
      console.error('Error syncing TPN product live:', err);
    }
    return product;
  }`;

// Replace the entire function
const functionEndRegex = /async function syncTopupNationProductLive[\s\S]*?return product;\s*\n\s*}/;

if (bot.includes('async function syncTopupNationProductLive')) {
  // First, find where it ends
  const match = bot.match(/async function syncTopupNationProductLive[\s\S]*?catch \(err\) {[\s\S]*?}[\s\S]*?}/);
  if (match) {
    bot = bot.replace(match[0], syncFunctionNew);
    console.log("Replaced syncTopupNationProductLive definition.");
  }
}

// Now replace where it's called
bot = bot.replace(
  "await syncTopupNationProductLive(matchedTpn, activeShortKey);",
  "matchedTpn = await syncTopupNationProductLive(matchedTpn, activeShortKey);"
);

fs.writeFileSync(botPath, bot);
console.log("Patched bot.ts sync logic");

