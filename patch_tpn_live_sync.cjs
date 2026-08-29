const fs = require('fs');

const botPath = 'server/bot.ts';
let bot = fs.readFileSync(botPath, 'utf8');

const syncFunction = `
  async function syncTopupNationProductLive(product: any, shortKey: string) {
    if (!topupNation || !topupNation.getClient()?.isConfigured()) return;
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
        product.lastSyncedAt = new Date();
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
            } catch (e) {
              // ignore
            }
          }
        }
      }
    } catch (err) {
      console.error('Error syncing TPN product live:', err);
    }
  }

  // Universal Short Key Listener (e.g. .p, .ml, .ff, /p, etc.)`;

if (!bot.includes('syncTopupNationProductLive(')) {
  bot = bot.replace('  // Universal Short Key Listener (e.g. .p, .ml, .ff, /p, etc.)', syncFunction);
}

const matchTarget = `        if (matchedTpn) {
          if (matchedTpn.isEnabled === false || matchedTpn.status === 'DISABLED') {
            return ctx.reply(\`⚠️ *\${matchedTpn.name}* is currently disabled by Admin.\`, { parse_mode: 'Markdown' });
          }
          const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();
          
          if (rawArgs.length === 0) {`;

const matchReplacement = `        if (matchedTpn) {
          if (matchedTpn.isEnabled === false || matchedTpn.status === 'DISABLED') {
            return ctx.reply(\`⚠️ *\${matchedTpn.name}* is currently disabled by Admin.\`, { parse_mode: 'Markdown' });
          }
          const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();
          
          // Live sync before processing
          await syncTopupNationProductLive(matchedTpn, activeShortKey);

          if (rawArgs.length === 0) {`;

if (bot.includes(matchTarget) && !bot.includes('syncTopupNationProductLive(matchedTpn, activeShortKey)')) {
  bot = bot.replace(matchTarget, matchReplacement);
  console.log("Patched match target");
} else {
  // Try fallback match
  const fallbackTarget = `        if (matchedTpn) {
          if (matchedTpn.isEnabled === false || matchedTpn.status === 'DISABLED') {
            return ctx.reply(\`⚠️ *\${matchedTpn.name}* is currently disabled by Admin.\`, { parse_mode: 'Markdown' });
          }
          const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();
          if (rawArgs.length === 0) {`;
  
  const fallbackReplacement = `        if (matchedTpn) {
          if (matchedTpn.isEnabled === false || matchedTpn.status === 'DISABLED') {
            return ctx.reply(\`⚠️ *\${matchedTpn.name}* is currently disabled by Admin.\`, { parse_mode: 'Markdown' });
          }
          const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();
          
          // Live sync before processing
          await syncTopupNationProductLive(matchedTpn, activeShortKey);

          if (rawArgs.length === 0) {`;
          
  if (bot.includes(fallbackTarget)) {
    bot = bot.replace(fallbackTarget, fallbackReplacement);
    console.log("Patched fallback match target");
  } else {
    console.log("Could not find match target!");
  }
}

fs.writeFileSync(botPath, bot);
