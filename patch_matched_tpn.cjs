const fs = require('fs');

const botPath = 'server/bot.ts';
let bot = fs.readFileSync(botPath, 'utf8');

const target = "          const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();";
const replacement = "          const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();\\n          await syncTopupNationProductLive(matchedTpn, activeShortKey);";

bot = bot.replace(target, replacement);

fs.writeFileSync(botPath, bot);
