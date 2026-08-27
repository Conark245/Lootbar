const fs = require('fs');

let bot = fs.readFileSync('server/bot.ts', 'utf8');

const target1 = `    // Direct API Linked VIP or Owner: Show Live API Balances
    const [lbRes, tpnRes] = await Promise.all([
      getLootBarLiveBalance(),
      getTopupNationLiveBalance()
    ]);`;

const replacement1 = `    // Direct API Linked VIP or Owner: Show Live API Balances
    const [lbRes, tpnRes, fzrRes] = await Promise.all([
      getLootBarLiveBalance(),
      getTopupNationLiveBalance(),
      getFzrCardsLiveBalance()
    ]);`;

const target2 = `      \`🎮 *LootBar API:* \\\`$\${lbRes.balance} USD\\\` (\${lbRes.success ? '✅ Connected' : '⚠️ Offline'})\\n\` +
      \`🌐 *TopupNation API:* \\\`$\${tpnRes.balance} USD\\\` (\${tpnRes.success ? '✅ Connected' : '⚠️ Offline'})\\n\` +
      \`═════════════════════════\\n\` +`;

const replacement2 = `      \`🎮 *LootBar API:* \\\`$\${lbRes.balance} USD\\\` (\${lbRes.success ? '✅ Connected' : '⚠️ Offline'})\\n\` +
      \`🌐 *TopupNation API:* \\\`$\${tpnRes.balance} USD\\\` (\${tpnRes.success ? '✅ Connected' : '⚠️ Offline'})\\n\` +
      \`⚡ *FZR Cards API:* \\\`$\${fzrRes.balance} USD\\\` (\${fzrRes.success ? '✅ Connected' : '⚠️ Offline'})\\n\` +
      \`═════════════════════════\\n\` +`;

const target3 = `    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🎮 LootBar Balance', 'api_bal_lootbar'),
        Markup.button.callback('🌐 TopupNation Balance', 'api_bal_topupnation')
      ],
      [
        Markup.button.callback('🔄 Both API Balances', 'api_bal_both'),
        Markup.button.callback('💰 Request Top-Up', 'topup_flow_start')
      ],
      [
        Markup.button.callback('👤 My Account Profile', 'view_my_profile')
      ]
    ]);`;

const replacement3 = `    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🎮 LootBar', 'api_bal_lootbar'),
        Markup.button.callback('🌐 TopupNation', 'api_bal_topupnation'),
        Markup.button.callback('⚡ FZR Cards', 'api_bal_fzrcards')
      ],
      [
        Markup.button.callback('🔄 All APIs', 'api_bal_both'),
        Markup.button.callback('💰 Request Top-Up', 'topup_flow_start')
      ],
      [
        Markup.button.callback('👤 My Account Profile', 'view_my_profile')
      ]
    ]);`;

let patched = bot;
if (bot.includes(target1)) {
  patched = patched.replace(target1, replacement1);
  console.log("Patched target 1");
} else {
  console.log("Could not find target 1");
}

if (bot.includes(target2)) {
  patched = patched.replace(target2, replacement2);
  console.log("Patched target 2");
} else {
  console.log("Could not find target 2");
}

if (bot.includes(target3)) {
  patched = patched.replace(target3, replacement3);
  console.log("Patched target 3");
} else {
  console.log("Could not find target 3");
}

if (patched !== bot) {
  fs.writeFileSync('server/bot.ts', patched);
}
