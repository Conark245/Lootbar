import re

with open('server/bot.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Update renderAllGamesList to include G2Bulk
old_all_games_query = """
      const fzrGames = await FzrCardsProduct.find({ 
        isEnabled: { $ne: false }, 
        status: { $ne: 'DISABLED' } 
      }).sort({ name: 1 });

      if (lootbarGames.length === 0 && tpnGames.length === 0 && fzrGames.length === 0) {
"""

new_all_games_query = """
      const fzrGames = await FzrCardsProduct.find({ 
        isEnabled: { $ne: false }, 
        status: { $ne: 'DISABLED' } 
      }).sort({ name: 1 });
      const g2bGames = await G2BulkProduct.find({ 
        isEnabled: { $ne: false }, 
        status: { $ne: 'DISABLED' } 
      }).sort({ name: 1 });

      if (lootbarGames.length === 0 && tpnGames.length === 0 && fzrGames.length === 0 && g2bGames.length === 0) {
"""

code = code.replace(old_all_games_query, new_all_games_query)

old_all_games_display = """
      if (fzrGames.length > 0) {
        msg += `💎 *[FZR Cards API Games]*\\n`;
        fzrGames.forEach(p => {
          const sk = (p.shortKey || `f${p.productId.slice(0, 4)}`).toLowerCase();
          msg += `• *${p.name}* ➔ \\`.${sk}\\`\\n`;
        });
        msg += `\\n`;
      }

      msg += `━━━━━━━━━━━━━━━━━━━━\\n` +
"""

new_all_games_display = """
      if (fzrGames.length > 0) {
        msg += `💎 *[FZR Cards API Games]*\\n`;
        fzrGames.forEach(p => {
          const sk = (p.shortKey || `f${p.productId.slice(0, 4)}`).toLowerCase();
          msg += `• *${p.name}* ➔ \\`.${sk}\\`\\n`;
        });
        msg += `\\n`;
      }

      if (g2bGames.length > 0) {
        msg += `🔥 *[G2Bulk API Games]*\\n`;
        g2bGames.forEach(p => {
          const sk = (p.shortKey || `g${p.productId.slice(0, 4)}`).toLowerCase();
          msg += `• *${p.name}* ➔ \\`.${sk}\\`\\n`;
        });
        msg += `\\n`;
      }

      msg += `━━━━━━━━━━━━━━━━━━━━\\n` +
"""

code = code.replace(old_all_games_display, new_all_games_display)

with open('server/bot.ts', 'w', encoding='utf-8') as f:
    f.write(code)

