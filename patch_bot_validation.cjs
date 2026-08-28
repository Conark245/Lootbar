const fs = require('fs');

let bot = fs.readFileSync('server/bot.ts', 'utf8');

const target = `    // Optional: Try to resolve player name in background if available
    if (!playerName && gameId && Object.keys(extraInfo).length > 0) {
      try {
        const checkResult = await lootbar.checkRole(gameId, extraInfo);
        if (checkResult?.playerName) {
          playerName = checkResult.playerName;
          ctx.session.playerName = checkResult.playerName;
        }
      } catch {
        // Never block purchase
      }
    }`;

const replacement = `    // Optional: Try to resolve player name in background if available
    if (!playerName && gameId && Object.keys(extraInfo).length > 0) {
      try {
        let checkResult;
        if (ctx.session.provider === 'topupnation' && topupNation) {
          checkResult = await topupNation.checkRole(gameId, extraInfo);
        } else if (ctx.session.provider === 'lootbar') {
          checkResult = await lootbar.checkRole(gameId, extraInfo);
        }
        
        if (checkResult?.playerName) {
          playerName = checkResult.playerName;
          ctx.session.playerName = checkResult.playerName;
        }
      } catch (err) {
        // Never block purchase
      }
    }`;

if (bot.includes(target)) {
  bot = bot.replace(target, replacement);
  fs.writeFileSync('server/bot.ts', bot);
  console.log("Patched showOrderConfirmation");
} else {
  console.log("Could not find target in bot.ts");
}
