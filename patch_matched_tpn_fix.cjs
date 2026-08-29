const fs = require('fs');

const botPath = 'server/bot.ts';
let bot = fs.readFileSync(botPath, 'utf8');

bot = bot.replace("const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();\\n          await syncTopupNationProductLive(matchedTpn, activeShortKey);",
  "const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();\n          await syncTopupNationProductLive(matchedTpn, activeShortKey);");

fs.writeFileSync(botPath, bot);
