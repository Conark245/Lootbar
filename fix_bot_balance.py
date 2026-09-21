import re

with open('server/bot.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# First, remove the `renderDualApiBalance` function
content = re.sub(r'async function renderDualApiBalance.*?}\s*async function renderBalance', 'async function renderBalance', content, flags=re.DOTALL)

# Now rewrite renderBalance
render_balance_new = """async function renderBalance(ctx: MyContext, isEdit: boolean = false) {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    
    let msg = `💳 *Your Wallet Balance*\\n` +
      `═════════════════════════\\n` +
      `💰 *Current Balance:* \\`$${Number(user?.balance || 0).toFixed(3)} USD\\`\\n` +
      `📦 *Ordering Mode:* \\`Pre-funded Wallet Balance\\`\\n` +
      `═════════════════════════\\n` +
      `_💡 သင့် Wallet ထဲသို့ ငွေဖြည့်သွင်းလိုပါက အောက်ပါ Request Balance Top-Up ခလုတ်ကို နှိပ်ပါ:_`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💰 Request Balance Top-Up', 'topup_flow_start'),
        Markup.button.callback('👤 My Account Profile', 'view_my_profile')
      ]
    ]);

    if (isEdit) {
      return await safeEditMessageText(ctx, msg, keyboard);
    } else {
      return await safeReply(ctx, msg, keyboard);
    }
  }

  // Action Handlers for API Balance Switcher"""

content = re.sub(r'async function renderBalance\(ctx: MyContext, isEdit: boolean = false\) \{.*?// Action Handlers for API Balance Switcher', render_balance_new, content, flags=re.DOTALL)

# Now remove the action handlers for api_bal_*
content = re.sub(r"bot\.action\('api_bal_both', async \(ctx\) => \{.*?\n  \}\);\n", '', content, flags=re.DOTALL)
content = re.sub(r"bot\.action\('api_bal_lootbar', async \(ctx\) => \{.*?\n  \}\);\n", '', content, flags=re.DOTALL)
content = re.sub(r"bot\.action\('api_bal_topupnation', async \(ctx\) => \{.*?\n  \}\);\n", '', content, flags=re.DOTALL)
content = re.sub(r"bot\.action\('api_bal_fzrcards', async \(ctx\) => \{.*?\n  \}\);\n", '', content, flags=re.DOTALL)
content = re.sub(r"bot\.action\('api_bal_g2bulk', async \(ctx\) => \{.*?\n  \}\);\n", '', content, flags=re.DOTALL)

# Handle text commands to remove renderDualApiBalance usage
content = re.sub(r"return await renderDualApiBalance\(ctx, '[^']+'\);", "return await renderBalance(ctx);", content)

with open('server/bot.ts', 'w', encoding='utf-8') as f:
    f.write(content)
