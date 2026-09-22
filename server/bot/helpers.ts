import { Context } from 'telegraf';

// Helper to escape text for Telegram Markdown v1
export function escapeMd(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[_*[\]`]/g, '\\$&');
}

// Helper to sanitize code block content (prevent breaking out of backticks)
export function escapeCode(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[`\\]/g, '');
}

// Helper to format Date/Timestamp in Myanmar Time (GMT+6:30 / Asia/Yangon)
export function formatMyanmarDateTime(date: Date | string | number | undefined = new Date()): string {
  try {
    const d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString('en-GB', {
      timeZone: 'Asia/Yangon',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return new Date().toLocaleString();
  }
}

export function formatMyanmarTimeOnly(date: Date | string | number | undefined = new Date()): string {
  try {
    const d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Yangon',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return new Date().toLocaleTimeString();
  }
}

export async function safeReply(ctx: Context, text: string, extra: any = {}) {
  try {
    return await ctx.reply(text, extra);
  } catch (err: any) {
    console.error('[Bot Error] safeReply failed:', err.message);
    try {
      if (err.response && err.response.error_code === 403) {
        console.log(`User ${ctx.from?.id} blocked the bot.`);
      } else {
        return await ctx.reply(text, { parse_mode: undefined, ...extra, reply_markup: extra.reply_markup });
      }
    } catch (fallbackErr: any) {
      console.error('[Bot Error] fallback safeReply failed:', fallbackErr.message);
    }
    return null;
  }
}

export async function safeSendMessage(telegram: any, chatId: number | string, text: string, extra: any = {}) {
  try {
    return await telegram.sendMessage(chatId, text, extra);
  } catch (err: any) {
    console.error(`[Bot Error] safeSendMessage to ${chatId} failed:`, err.message);
    if (err.response && err.response.error_code === 403) {
      console.log(`User ${chatId} blocked the bot.`);
    } else {
      try {
        return await telegram.sendMessage(chatId, text, { parse_mode: undefined, ...extra, reply_markup: extra.reply_markup });
      } catch (e: any) {
        console.error('[Bot Error] fallback safeSendMessage failed:', e.message);
      }
    }
    return null;
  }
}

export async function safeEditMessageText(ctx: Context, text: string, extra: any = {}) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (err: any) {
    if (err.description && err.description.includes('message is not modified')) {
      return null;
    }
    console.error('[Bot Error] safeEditMessageText failed:', err.message);
    try {
      return await ctx.editMessageText(text, { parse_mode: undefined, ...extra, reply_markup: extra.reply_markup });
    } catch (e: any) {
      console.error('[Bot Error] fallback safeEditMessageText failed:', e.message);
    }
    return null;
  }
}

export async function safeSendPhoto(telegram: any, chatId: number | string, photo: string, extra: any = {}) {
  try {
    return await telegram.sendPhoto(chatId, photo, extra);
  } catch (err: any) {
    console.error(`[Bot Error] safeSendPhoto to ${chatId} failed:`, err.message);
    if (err.response && err.response.error_code === 403) {
      console.log(`User ${chatId} blocked the bot.`);
    } else {
      try {
        return await telegram.sendPhoto(chatId, photo, { parse_mode: undefined, ...extra, reply_markup: extra.reply_markup });
      } catch (e: any) {
        console.error('[Bot Error] fallback safeSendPhoto failed:', e.message);
      }
    }
    return null;
  }
}

export async function safeEditMessageCaption(ctx: Context, caption: string, extra: any = {}) {
  try {
    return await ctx.editMessageCaption(caption, extra);
  } catch (err: any) {
    if (err.description && err.description.includes('message is not modified')) {
      return null;
    }
    console.error('[Bot Error] safeEditMessageCaption failed:', err.message);
    try {
      return await ctx.editMessageCaption(caption, { parse_mode: undefined, ...extra, reply_markup: extra.reply_markup });
    } catch (e: any) {
      console.error('[Bot Error] fallback safeEditMessageCaption failed:', e.message);
    }
    return null;
  }
}

// Helper to cleanly parse command arguments respecting parentheses, brackets, and commas
export function parseCommandArgs(rawText: string): string[] {
  if (!rawText) return [];
  const cleaned = rawText
    .replace(/[()[\],]/g, ' ')
    .trim();
  return cleaned.split(/\s+/).filter(Boolean);
}

/**
 * Checks whether the given user is configured to use Direct API Balance
 * for the specified provider (e.g. 'lootbar', 'topupnation', 'g2bulk').
 * 
 * Rules:
 * 1. If user is not in API balance mode (useDirectApiBalance is false and balanceMode !== 'api'), returns false.
 * 2. If apiProvider is 'all' or undefined, returns true for any provider.
 * 3. If apiProvider is 'both', returns true for 'lootbar' and 'topupnation'.
 * 4. Otherwise, returns true only if apiProvider matches the specific provider name.
 */
export function isProviderApiLinked(user: any, provider: string): boolean {
  if (!user) return false;
  const isApiMode = user.balanceMode === 'api' || !!user.useDirectApiBalance;
  if (!isApiMode) return false;

  const targetProvider = (provider || 'lootbar').toLowerCase();
  const userProvider = (user.apiProvider || 'all').toLowerCase();

  if (userProvider === 'all') return true;
  if (userProvider === 'both') {
    return targetProvider === 'lootbar' || targetProvider === 'topupnation';
  }
  return userProvider === targetProvider;
}

export function getGameDefaultShortKey(name: string, gameId?: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('pubg')) return 'p';
  if (n.includes('mobile legends') || n.includes('mlbb')) return 'ml';
  if (n.includes('free fire')) return 'ff';
  if (n.includes('genshin')) return 'gi';
  if (n.includes('honkai') || n.includes('star rail')) return 'hsr';
  if (n.includes('roblox')) return 'rbx';
  if (n.includes('arena of valor') || n.includes('aov')) return 'aov';
  if (n.includes('call of duty') || n.includes('codm')) return 'codm';
  if (n.includes('clash of clans') || n.includes('coc')) return 'coc';
  if (n.includes('brawl stars')) return 'bs';
  
  const words = n.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const initials = words.map(w => w[0]).join('');
    if (initials.length >= 2) return initials.slice(0, 4);
  }
  return n.slice(0, 3) || (gameId ? `g${String(gameId).slice(0, 3)}` : 'game');
}

