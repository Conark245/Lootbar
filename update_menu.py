import re

with open('server/bot.ts', 'r') as f:
    content = f.read()

target_menu = """  const mainMenu = Markup.keyboard([
    ['🎮 LootBar Games', '🌐 TopupNation Games'],
    ['💎 FZR Cards Games', '📦 Bulk Order'],
    ['💰 Request Top-Up', '📜 Order History'],
    ['👤 My Account', '💳 Check Balance']
  ]).resize();"""

replacement_menu = """  const mainMenu = Markup.keyboard([
    ['🎮 All Games', '📦 Bulk Order'],
    ['🎮 LootBar Games', '🌐 TopupNation Games'],
    ['💎 FZR Cards Games', '💰 Request Top-Up'],
    ['📜 Order History', '💳 Check Balance'],
    ['👤 My Account']
  ]).resize();"""

content = content.replace(target_menu, replacement_menu)

# Also update the bot.hears for 'All Games' just in case
content = content.replace(
    "bot.hears(['🎮 Game List', 'Game List', 'Games', 'games', '🎮 Games'], async (ctx) => {",
    "bot.hears(['🎮 Game List', 'Game List', 'Games', 'games', '🎮 Games', '🎮 All Games'], async (ctx) => {"
)

with open('server/bot.ts', 'w') as f:
    f.write(content)

