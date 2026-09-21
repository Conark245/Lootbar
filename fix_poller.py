with open('server/pricePoller.ts', 'r', encoding='utf-8') as f:
    code = f.read()

notify_code = """
  private async notifyUsers(providerName: string, gameName: string, shortKey: string, changes: string[]) {
    if (!this.telegramNotifier) return;
    const safeName = gameName.replace(/[*_`\[\]]/g, '');
    const skInfo = shortKey ? ` (\\`.${shortKey}\\`)` : '';
    const msg = `🔔 *${providerName} Price Update*\\n\\n🎮 *${safeName}*${skInfo}\\n\\n${changes.join('\\n\\n')}`;
    
    const users = await User.find({ isAuthorized: true, receivesNotifications: { $ne: false } });
    for (const u of users) {
      if (u.telegramChatId) {
        await this.telegramNotifier(u.telegramChatId, msg).catch(() => {});
      }
    }
  }

  private async notify(chatId: number, msg: string) {
    if (this.telegramNotifier) {
      await this.telegramNotifier(chatId, msg).catch(() => {});
    }
  }
}"""

code = code.replace("  }\n}", "  }\n" + notify_code)

with open('server/pricePoller.ts', 'w', encoding='utf-8') as f:
    f.write(code)
