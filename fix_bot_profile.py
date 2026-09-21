import re

with open('server/bot.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add a simple renderAccountProfile
render_profile = """
  async function renderAccountProfile(ctx: MyContext, isEdit: boolean = false) {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    
    let msg = `👤 *Your Profile*\\n` +
      `═════════════════════════\\n` +
      `📛 *Name:* \\`${user?.firstName || 'User'}\\`\\n` +
      `🆔 *ID:* \\`${user?.telegramChatId}\\`\\n` +
      `💰 *Wallet Balance:* \\`$${Number(user?.balance || 0).toFixed(3)} USD\\`\\n` +
      `═════════════════════════\\n`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💳 Check Balance', 'view_my_balance'),
        Markup.button.callback('📜 Order History', 'view_my_orders')
      ]
    ]);

    if (isEdit) {
      return await safeEditMessageText(ctx, msg, keyboard);
    } else {
      return await safeReply(ctx, msg, keyboard);
    }
  }
"""

content = content.replace("async function renderBalance", render_profile + "\n  async function renderBalance")

with open('server/bot.ts', 'w', encoding='utf-8') as f:
    f.write(content)
