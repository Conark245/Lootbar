const fs = require('fs');

let bot = fs.readFileSync('server/bot.ts', 'utf8');

bot = bot.replace(
  "`🎮 *LootBar API:* \\`${lbRes.balance} USD\\` (${lbRes.success ? '✅ Connected' : '⚠️ Offline'})\\n` +",
  "`🎮 *LootBar API:* \\`$${lbRes.balance} USD\\` (${lbRes.success ? '✅ Connected' : '⚠️ Offline'})\\n` +"
);

bot = bot.replace(
  "`🌐 *TopupNation API:* \\`${tpnRes.balance} USD\\` (${tpnRes.success ? '✅ Connected' : '⚠️ Offline'})\\n` +",
  "`🌐 *TopupNation API:* \\`$${tpnRes.balance} USD\\` (${tpnRes.success ? '✅ Connected' : '⚠️ Offline'})\\n` +"
);

bot = bot.replace(
  "`⚡ *FZR Cards API:* \\`${fzrRes.balance} USD\\` (${fzrRes.success ? '✅ Connected' : '⚠️ Offline'})\\n` +",
  "`⚡ *FZR Cards API:* \\`$${fzrRes.balance} USD\\` (${fzrRes.success ? '✅ Connected' : '⚠️ Offline'})\\n` +"
);

fs.writeFileSync('server/bot.ts', bot);
