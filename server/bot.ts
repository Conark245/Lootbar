import { Telegraf, Markup, Context } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { LootBarClient } from './lootbar';
import { TopupNationService } from './providers/topupnation/TopupNationService';
import { TopupNationProduct } from './models/TopupNationProduct';
import { Order } from './models/Order';
import { User } from './models/User';
import { Session } from './models/Session';
import { AppConfig } from './models/AppConfig';
import { SavedGame } from './models/SavedGame';
import { TopupRequest } from './models/TopupRequest';

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

// Safe reply with fallback to plain text if Markdown parsing fails
export async function safeReply(ctx: Context, text: string, extra: any = {}) {
  try {
    return await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
  } catch (err: any) {
    if (err?.message?.includes('can\'t parse entities') || err?.response?.error_code === 400) {
      const plainText = text.replace(/[*_`\[\]]/g, '');
      return await ctx.reply(plainText, extra);
    }
    console.error('Error in safeReply:', err?.message || err);
    try {
      return await ctx.reply(text.replace(/[*_`\[\]]/g, ''));
    } catch {}
  }
}

// Safe sendMessage with fallback to plain text if Markdown parsing fails
export async function safeSendMessage(telegram: any, chatId: number | string, text: string, extra: any = {}) {
  try {
    return await telegram.sendMessage(chatId, text, { parse_mode: 'Markdown', ...extra });
  } catch (err: any) {
    if (err?.message?.includes('can\'t parse entities') || err?.response?.error_code === 400) {
      const plainText = text.replace(/[*_`\[\]]/g, '');
      return await telegram.sendMessage(chatId, plainText, extra);
    }
    console.error(`Error in safeSendMessage to ${chatId}:`, err?.message || err);
    try {
      return await telegram.sendMessage(chatId, text.replace(/[*_`\[\]]/g, ''));
    } catch {}
  }
}

// Safe editMessageText with fallback to plain text
export async function safeEditMessageText(ctx: Context, text: string, extra: any = {}) {
  try {
    return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...extra });
  } catch (err: any) {
    if (err?.message?.includes('message is not modified')) {
      return;
    }
    if (err?.message?.includes('can\'t parse entities') || err?.response?.error_code === 400) {
      const plainText = text.replace(/[*_`\[\]]/g, '');
      return await ctx.editMessageText(plainText, extra);
    }
    console.error('Error in safeEditMessageText:', err?.message || err);
  }
}

// Safe sendPhoto with fallback to plain caption if Markdown parsing fails
export async function safeSendPhoto(telegram: any, chatId: number | string, photo: string, extra: any = {}) {
  try {
    return await telegram.sendPhoto(chatId, photo, { parse_mode: 'Markdown', ...extra });
  } catch (err: any) {
    if (err?.message?.includes('can\'t parse entities') || err?.response?.error_code === 400) {
      const caption = extra.caption ? extra.caption.replace(/[*_`\[\]]/g, '') : undefined;
      return await telegram.sendPhoto(chatId, photo, { ...extra, caption, parse_mode: undefined });
    }
    console.error(`Error in safeSendPhoto to ${chatId}:`, err?.message || err);
  }
}

// Safe editMessageCaption with fallback to plain caption
export async function safeEditMessageCaption(ctx: Context, caption: string, extra: any = {}) {
  try {
    return await ctx.editMessageCaption(caption, { parse_mode: 'Markdown', ...extra });
  } catch (err: any) {
    if (err?.message?.includes('message is not modified')) {
      return;
    }
    if (err?.message?.includes('can\'t parse entities') || err?.response?.error_code === 400) {
      const plainCaption = caption.replace(/[*_`\[\]]/g, '');
      return await ctx.editMessageCaption(plainCaption, extra);
    }
    try {
      return await safeEditMessageText(ctx, caption, extra);
    } catch {}
    console.error('Error in safeEditMessageCaption:', err?.message || err);
  }
}

async function getAdminChatId(defaultId: string | undefined): Promise<string | undefined> {
  try {
    const config = await AppConfig.findOne({ key: 'admin_chat_id' });
    return config?.value || defaultId;
  } catch { return defaultId; }
}


// We augment the session context to keep track of conversation state
interface SessionData {
  provider?: 'lootbar' | 'topupnation';
  step?: string;
  gameId?: string;
  gameName?: string;
  skus?: any[];
  skuId?: string;
  skuName?: string;
  skuPrice?: number;
  playerName?: string;
  requiredFields?: any[];
  currentFieldIndex?: number;
  extraInfo?: Record<string, string>;
  topupAmount?: number;
  topupNote?: string;
  topupPhotoFileId?: string;
}

export interface MyContext extends Context {
  session: SessionData;
}

export function setupBot(
  botToken: string, 
  adminChatId: string | undefined, 
  lootbar: LootBarClient,
  options: { isServerless?: boolean; webhookUrl?: string } = {},
  topupNation?: TopupNationService
) {
  const bot = new Telegraf<MyContext>(botToken);
  
  // Global bot error handler to prevent crashing or unhandled rejections
  bot.catch((err: any, ctx: Context) => {
    console.error(`Telegram Bot Error (update: ${ctx.updateType}):`, err?.message || err);
  });
  
  // MongoDB Session Middleware
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId) {
      let sessionDoc = await Session.findOne({ chatId });
      if (!sessionDoc) {
        sessionDoc = await Session.create({ chatId, data: {} });
      }
      ctx.session = (sessionDoc.data as SessionData) || {};
      
      await next();
      
      // Save session back to DB after processing
      if (ctx.session) {
        await Session.updateOne({ chatId }, { data: ctx.session }, { upsert: true });
      }
    } else {
      return next();
    }
  });

  // User Authorization Middleware
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();

    const fromUsername = ctx.from?.username || (ctx.chat as any)?.username || undefined;
    const fromFirstName = ctx.from?.first_name || (ctx.chat as any)?.first_name || undefined;

    let user = await User.findOne({ telegramChatId: chatId });
    
    // Auto-authorize admin
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(chatId) === currentAdminId) {
      if (!user) {
        user = await User.create({ 
          telegramChatId: chatId, 
          isAuthorized: true,
          username: fromUsername,
          firstName: fromFirstName
        });
      } else {
        const updateData: any = {};
        if (!user.isAuthorized) updateData.isAuthorized = true;
        if (fromUsername && user.username !== fromUsername) updateData.username = fromUsername;
        if (fromFirstName && user.firstName !== fromFirstName) updateData.firstName = fromFirstName;
        if (Object.keys(updateData).length > 0) {
          user = await User.findOneAndUpdate({ telegramChatId: chatId }, updateData, { new: true });
        }
      }
    } else {
      if (!user) {
        // Create user with isAuthorized: false to show up in UI and allow inline approval
        user = await User.create({ 
          telegramChatId: chatId, 
          isAuthorized: false,
          username: fromUsername,
          firstName: fromFirstName
        });
      } else if ((fromUsername && user.username !== fromUsername) || (fromFirstName && user.firstName !== fromFirstName)) {
        user = await User.findOneAndUpdate(
          { telegramChatId: chatId }, 
          { username: fromUsername, firstName: fromFirstName }, 
          { new: true }
        );
      }
    }

    if (!user || !user.isAuthorized) {
      // If it's a message, inform them. Don't spam on callbacks.
      if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/start')) {
        await ctx.reply(`🚫 You are not authorized to use this bot.\n\nYour Chat ID is: \`${chatId}\`\n\nA request has been sent to the admin. Please wait for approval.`, { parse_mode: 'Markdown' });
        
        const chatObj = ctx.chat as any;
        const currentAdminIdForNotify = await getAdminChatId(adminChatId);
        if (currentAdminIdForNotify) {
          try {
            await bot.telegram.sendMessage(
              adminChatId,
              `🔔 *New User Request*\nChat ID: \`${chatId}\`\nUsername: @${chatObj?.username || 'Unknown'}\nName: ${chatObj?.first_name || ''} ${chatObj?.last_name || ''}`,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                  Markup.button.callback('✅ Approve', `approve_user_${chatId}`),
                  Markup.button.callback('❌ Reject', `reject_user_${chatId}`)
                ])
              }
            );
          } catch (e) {
            console.error('Failed to notify admin of new user', e);
          }
        }
        return;
      }
      // If it's a callback, answer with an alert
      if (ctx.callbackQuery) {
        return ctx.answerCbQuery('🚫 Unauthorized', { show_alert: true });
      }
      return;
    }

    return next();
  });

  function getGameDefaultShortKey(name: string, gameId: string): string {
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
      return words.map(w => w[0]).join('').slice(0, 4);
    }
    return words[0]?.slice(0, 4) || `g${gameId}`;
  }

  const mainMenu = Markup.keyboard([
    ['🎮 LootBar Games', '🌐 TopupNation Games'],
    ['👤 My Account', '💳 Check Balance'],
    ['💰 Request Top-Up', '📜 Order History']
  ]).resize();

  bot.command('start', async (ctx) => {
    ctx.session = {}; // reset session
    return ctx.reply(
      '🎮 *Welcome to the Game Top-Up Bot!*\n\n' +
      'သင်ဝယ်ယူလိုသော API Provider အလိုက် Games စာရင်းကို အောက်ပါ Menu မှ ရွေးချယ်ကြည့်ရှုနိုင်ပါသည်:\n' +
      '• *🎮 LootBar Games* — LootBar API Games စာရင်း\n' +
      '• *🌐 TopupNation Games* — TopupNation API Games စာရင်း\n\n' +
      '⚡ *အသုံးပြုနည်း အမြန်လမ်းညွှန်:*\n' +
      '• Game ၏ Products စာရင်း ကြည့်ရန်: `.<shortKey>` (ဥပမာ `.p`, `.ml`, `.tp`)\n' +
      '• အော်ဒါ တိုက်ရိုက်တင်ရန်: `.<shortKey> <Account ID> <Product>`\n' +
      '👉 _ဥပမာ:_ `.p 5123456789 60` သို့မဟုတ် `.tp 5123456789 60`',
      {
        parse_mode: 'Markdown',
        ...mainMenu
      }
    );
  });

  // Text-only Game List handler for LootBar (No buttons, Owner-enabled only)
  async function renderLootBarGameList(ctx: MyContext) {
    try {
      // Query ONLY enabled games
      let savedGames = await SavedGame.find({ isEnabled: { $ne: false } }).sort({ savedAt: -1 });

      if (!savedGames || savedGames.length === 0) {
        // Check if any games exist at all
        const anyGames = await SavedGame.countDocuments();
        if (anyGames === 0) {
          const response = await lootbar.getGames();
          const allGames = response?.data?.items || [];
          if (allGames.length > 0) {
            for (const g of allGames.slice(0, 6)) {
              const gId = String(g.id || g.game_id);
              const gName = g.name || g.game_name || 'Game';
              const shortKey = getGameDefaultShortKey(gName, gId);
              await SavedGame.findOneAndUpdate(
                { gameId: gId },
                { name: gName, shortKey, isEnabled: true },
                { upsert: true, new: true }
              );
            }
            savedGames = await SavedGame.find({ isEnabled: { $ne: false } }).sort({ savedAt: -1 });
          }
        }
      }

      if (!savedGames || savedGames.length === 0) {
        return ctx.reply('⚠️ No LootBar games are currently enabled by the Owner. Please contact the administrator.');
      }

      let msg = `🎮 *LootBar API — ရရှိနိုင်သော Games စာရင်း*\n\n` +
        `အောက်ပါ Game များအား Top-Up ဝယ်ယူနိုင်ပါသည်။ Product စာရင်း ကြည့်ရှုရန် သို့မဟုတ် အော်ဒါတင်ရန် သက်ဆိုင်ရာ *Short Key* ဖြင့် အသုံးပြုနိုင်ပါသည်:\n\n`;

      const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

      savedGames.forEach((game: any, index: number) => {
        const shortKey = (game.shortKey || getGameDefaultShortKey(game.name, game.gameId)).toLowerCase();
        const numEmoji = numEmojis[index] || `🔹`;

        let example = `.${shortKey} 123456789 60`;
        let format = `.${shortKey} <UID> <Product>`;
        const lowerName = game.name.toLowerCase();

        if (lowerName.includes('mobile legends') || lowerName.includes('mlbb')) {
          example = `.${shortKey} 12345678 2001 86`;
          format = `.${shortKey} <UID> <ZoneID> <Product>`;
        } else if (lowerName.includes('genshin') || lowerName.includes('star rail')) {
          example = `.${shortKey} 812345678 60`;
          format = `.${shortKey} <UID> <Product>`;
        } else if (lowerName.includes('free fire')) {
          example = `.${shortKey} 987654321 100`;
          format = `.${shortKey} <UID> <Product>`;
        }

        msg += `${numEmoji} *${game.name}*\n` +
          `   ▫️ *Short Key:* \`.${shortKey}\`\n` +
          `   ▫️ *Packages ကြည့်ရန်:* \`.${shortKey}\`\n` +
          `   ▫️ *Order တင်ရန်:* \`${format}\`\n` +
          `   ▫️ *ဥပမာ:* \`${example}\`\n\n`;
      });

      msg += `━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 *အသုံးပြုနည်း လမ်းညွှန်:*\n` +
        `• Packages & Prices ကြည့်ရှုရန်: \`.<shortKey>\` (ဥပမာ \`.p\`)\n` +
        `• တိုက်ရိုက် Order တင်ရန်: \`.<shortKey> <UID> <Product>\``;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Failed to fetch LootBar text game list:', error);
      return ctx.reply(`An error occurred while fetching the LootBar game list: ${error.message}`);
    }
  }

  // Text-only Game List handler for TopupNation (No buttons, Owner-enabled only)
  async function renderTopupNationGameList(ctx: MyContext) {
    try {
      // Query ONLY enabled products
      const products = await TopupNationProduct.find({ 
        isEnabled: { $ne: false }, 
        status: { $ne: 'DISABLED' } 
      }).sort({ name: 1 });

      if (!products || products.length === 0) {
        return ctx.reply('⚠️ No TopupNation games are currently enabled by the Owner. Please contact the administrator.');
      }

      let msg = `🌐 *TopupNation API — ရရှိနိုင်သော Games စာရင်း*\n\n` +
        `အောက်ပါ Game များအား TopupNation မှတစ်ဆင့် Top-Up ဝယ်ယူနိုင်ပါသည်။ Product စာရင်း ကြည့်ရှုရန် သို့မဟုတ် အော်ဒါတင်ရန် သက်ဆိုင်ရာ *Short Key* ဖြင့် အသုံးပြုနိုင်ပါသည်:\n\n`;

      const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

      products.forEach((p: any, index: number) => {
        const shortKey = (p.shortKey || `t${p.productId.slice(0, 4)}`).toLowerCase();
        const numEmoji = numEmojis[index] || `🔹`;

        const requiredFields = (p.fields || []).filter((f: any) => f.required);
        let format = `.${shortKey} <PlayerID> <Product>`;
        let example = `.${shortKey} 123456789 60`;

        if (requiredFields.length === 1) {
          const fName = requiredFields[0].title || requiredFields[0].name || 'PlayerID';
          format = `.${shortKey} <${fName}> <Product>`;
          example = `.${shortKey} 12345678 60`;
        } else if (requiredFields.length >= 2) {
          const f1 = requiredFields[0].title || requiredFields[0].name || 'Account';
          const f2 = requiredFields[1].title || requiredFields[1].name || 'Server';
          format = `.${shortKey} <${f1}> <${f2}> <Product>`;
          example = `.${shortKey} 12345678 2001 86`;
        }

        msg += `${numEmoji} *${p.name}*\n` +
          `   ▫️ *Short Key:* \`.${shortKey}\`\n` +
          `   ▫️ *Packages ကြည့်ရန်:* \`.${shortKey}\`\n` +
          `   ▫️ *Order တင်ရန်:* \`${format}\`\n` +
          `   ▫️ *ဥပမာ:* \`${example}\`\n\n`;
      });

      msg += `━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 *အသုံးပြုနည်း လမ်းညွှန်:*\n` +
        `• Packages & Prices ကြည့်ရှုရန်: \`.<shortKey>\` (ဥပမာ \`.${products[0]?.shortKey || 'tp'}\`)\n` +
        `• တိုက်ရိုက် Order တင်ရန်: \`.<shortKey> <Account> <Product>\``;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Failed to fetch TopupNation text game list:', error);
      return ctx.reply(`An error occurred while fetching the TopupNation game list: ${error.message}`);
    }
  }

  // Combined or generic Game List handler (shows both providers in text)
  async function renderAllGamesList(ctx: MyContext) {
    try {
      const lootbarGames = await SavedGame.find({ isEnabled: { $ne: false } }).sort({ savedAt: -1 });
      const tpnGames = await TopupNationProduct.find({ 
        isEnabled: { $ne: false }, 
        status: { $ne: 'DISABLED' } 
      }).sort({ name: 1 });

      if (lootbarGames.length === 0 && tpnGames.length === 0) {
        return ctx.reply('⚠️ No games are currently enabled by the Owner.');
      }

      let msg = `🎮 *ရရှိနိုင်သော Games စာရင်း အားလုံး (All Available Games)*\n\n`;

      if (lootbarGames.length > 0) {
        msg += `🔹 *[LootBar API Games]*\n`;
        lootbarGames.forEach(g => {
          const sk = (g.shortKey || getGameDefaultShortKey(g.name, g.gameId)).toLowerCase();
          msg += `• *${g.name}* ➔ \`.${sk}\`\n`;
        });
        msg += `\n`;
      }

      if (tpnGames.length > 0) {
        msg += `🌐 *[TopupNation API Games]*\n`;
        tpnGames.forEach(p => {
          const sk = (p.shortKey || `t${p.productId.slice(0, 4)}`).toLowerCase();
          msg += `• *${p.name}* ➔ \`.${sk}\`\n`;
        });
        msg += `\n`;
      }

      msg += `━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 *အသုံးပြုနည်း:* Package စာရင်းကြည့်ရန် \`.\` နောက်တွင် short key ရိုက်ပို့ပါ (ဥပမာ: \`.p\` သို့မဟုတ် \`.tp\`)`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      return ctx.reply(`Error: ${err.message}`);
    }
  }

  // Display packages & prices for a specific game when sending .<shortKey>
  async function handleGamePackageList(ctx: MyContext, game: any, shortKey: string) {
    try {
      const gameId = String(game.gameId || game.game_id);
      const gameName = game.name || game.game_name || 'Game';

      const response = await lootbar.getSkus(gameId);
      const skus = response?.data?.items || [];

      if (!skus || skus.length === 0) {
        return ctx.reply(`⚠️ No packages available for *${gameName}* at the moment from LootBar.`, { parse_mode: 'Markdown' });
      }

      // Determine extra info format
      const requiredFields = (skus[0]?.extra_info || []).filter((f: any) => f.required);
      let orderFormatDesc = `.${shortKey} <UID> <Product>`;
      let exampleDesc = `.${shortKey} 123456789 60`;

      if (requiredFields.length === 2) {
        const f1 = requiredFields[0].title || requiredFields[0].name || 'UID';
        const f2 = requiredFields[1].title || requiredFields[1].name || 'ZoneID';
        orderFormatDesc = `.${shortKey} <${f1}> <${f2}> <Product>`;
        exampleDesc = `.${shortKey} 12345678 2001 86`;
      } else if (requiredFields.length > 2) {
        const fieldsList = requiredFields.map((f: any) => `<${f.title || f.name}>`).join(' ');
        orderFormatDesc = `.${shortKey} ${fieldsList} <Product>`;
      }

      let msg = `🎮 *${gameName} — Packages & Prices*\n\n` +
        `📦 *ရရှိနိုင်သော Products စာရင်း:*\n`;

      skus.forEach((sku: any) => {
        const name = sku.sku_name || `Product #${sku.sku_id}`;
        const price = sku.reseller_price || sku.price || '0.00';
        msg += `▫️ *${name}* — \`$${Number(price).toFixed(2)} USD\`\n`;
      });

      msg += `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🛒 *Order တင်ရန် Command Format:*\n` +
        `\`${orderFormatDesc}\`\n\n` +
        `👉 *ဥပမာ:* \`${exampleDesc}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error('Error fetching game packages:', err);
      return ctx.reply(`❌ Error fetching package list: ${err.message}`);
    }
  }

// Helper to cleanly parse command arguments respecting parentheses, brackets, and commas
function parseCommandArgs(rawText: string): string[] {
  if (!rawText) return [];
  // Handles formatting like: "1235988728 (13997)wp", "1235988728(13997)14", "1235988728, 13997, wp", "1235988728 (13997) 14"
  const cleaned = rawText
    .replace(/[()[\],]/g, ' ')
    .trim();
  return cleaned.split(/\s+/).filter(Boolean);
}

// Smart SKU matching helpers for products with long or complex names
function findLootBarSkuMatch(skus: any[], rawQuery: string): any {
  if (!rawQuery || !skus || skus.length === 0) return null;
  const query = rawQuery.trim().toLowerCase();
  const cleanQuery = query.replace(/uc|diamond|diamonds|dm|gem|gems|credits|cp/g, '').trim();

  // 1. Exact SKU ID match
  const exactId = skus.find((s: any) => String(s.sku_id).toLowerCase() === query);
  if (exactId) return exactId;

  // 2. Exact name match
  const exactName = skus.find((s: any) => (s.sku_name || '').toLowerCase().trim() === query);
  if (exactName) return exactName;

  // 3. Exact alias mappings
  if (query === 'wp' || query === 'wdp' || query === 'weekly' || query === 'pass' || query === 'weekly pass' || query === 'weeklypass') {
    const wdp = skus.find((s: any) => /weekly/i.test(s.sku_name || '') || /wdp/i.test(s.sku_name || '') || /pass/i.test(s.sku_name || ''));
    if (wdp) return wdp;
  }
  if (query === 'tp' || query === 'twilight' || query === 'twilight pass' || query === 'twilightpass') {
    const tp = skus.find((s: any) => /twilight/i.test(s.sku_name || ''));
    if (tp) return tp;
  }
  if (query === 'monthly' || query === 'monthly pass' || query === 'monthlypass') {
    const monthly = skus.find((s: any) => /monthly/i.test(s.sku_name || ''));
    if (monthly) return monthly;
  }

  // 4. Number match (e.g. user typed "60" or "86" or "100" or "14")
  const queryNumbers = cleanQuery.match(/\d+/g) || query.match(/\d+/g);
  if (queryNumbers && queryNumbers.length > 0) {
    const targetNum = queryNumbers[0];
    
    // 4.1 Prioritize item starting with target number (e.g. "14 Diamonds" or "14 Diamonds (13+1)")
    const leadingNumMatch = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase().trim();
      return name.startsWith(targetNum + ' ') || name.startsWith(targetNum + 'd') || name.startsWith(targetNum + '(');
    });
    if (leadingNumMatch) return leadingNumMatch;

    // 4.2 Exact word boundary
    const exactWordNum = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase();
      const numRegex = new RegExp(`\\b${targetNum}\\b`);
      return numRegex.test(name);
    });
    if (exactWordNum) return exactWordNum;

    // 4.3 Any numeric match
    const anyNumMatch = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase();
      const nameNumbers = name.match(/\d+/g);
      return nameNumbers && nameNumbers.includes(targetNum);
    });
    if (anyNumMatch) return anyNumMatch;
  }

  // 5. Multi-word tokens match (all words in user query appear in sku_name)
  const tokens = query.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length > 1) {
    const tokenMatch = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase();
      return tokens.every(t => name.includes(t));
    });
    if (tokenMatch) return tokenMatch;
  }

  // 6. Substring match
  const subMatch = skus.find((s: any) => 
    (s.sku_name || '').toLowerCase().includes(query) || 
    (cleanQuery && (s.sku_name || '').toLowerCase().includes(cleanQuery))
  );
  if (subMatch) return subMatch;

  return null;
}

function findTopupNationSkuMatch(skus: any[], rawQuery: string): any {
  if (!rawQuery || !skus || skus.length === 0) return null;
  const query = rawQuery.trim().toLowerCase();
  const cleanQuery = query.replace(/uc|diamond|diamonds|dm|gem|gems|credits|cp/g, '').trim();

  // 1. Exact SKU ID match
  const exactId = skus.find((s: any) => String(s.sku).toLowerCase() === query);
  if (exactId) return exactId;

  // 2. Exact name match
  const exactName = skus.find((s: any) => (s.name || '').toLowerCase().trim() === query);
  if (exactName) return exactName;

  // 3. Exact alias mappings (Weekly Pass, Twilight Pass, Monthly)
  if (query === 'wp' || query === 'wdp' || query === 'weekly' || query === 'pass' || query === 'weekly pass' || query === 'weeklypass') {
    const wdp = skus.find((s: any) => /weekly/i.test(s.name || '') || /wdp/i.test(s.name || '') || /pass/i.test(s.name || ''));
    if (wdp) return wdp;
  }
  if (query === 'tp' || query === 'twilight' || query === 'twilight pass' || query === 'twilightpass') {
    const tp = skus.find((s: any) => /twilight/i.test(s.name || ''));
    if (tp) return tp;
  }
  if (query === 'monthly' || query === 'monthly pass' || query === 'monthlypass') {
    const monthly = skus.find((s: any) => /monthly/i.test(s.name || ''));
    if (monthly) return monthly;
  }

  // 4. Number match (e.g. user typed "14", "42", "86", "100")
  const queryNumbers = cleanQuery.match(/\d+/g) || query.match(/\d+/g);
  if (queryNumbers && queryNumbers.length > 0) {
    const targetNum = queryNumbers[0];

    // 4.1 Prioritize item starting with target number (e.g. "14 Diamonds" or "14 Diamonds (13+1)")
    const leadingNumMatch = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase().trim();
      return name.startsWith(targetNum + ' ') || name.startsWith(targetNum + 'd') || name.startsWith(targetNum + '(');
    });
    if (leadingNumMatch) return leadingNumMatch;

    // 4.2 Exact word boundary
    const exactWordNum = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase();
      const numRegex = new RegExp(`\\b${targetNum}\\b`);
      return numRegex.test(name);
    });
    if (exactWordNum) return exactWordNum;

    // 4.3 Any numeric match
    const anyNumMatch = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase();
      const nameNumbers = name.match(/\d+/g);
      return nameNumbers && nameNumbers.includes(targetNum);
    });
    if (anyNumMatch) return anyNumMatch;
  }

  // 5. Multi-word tokens match
  const tokens = query.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length > 1) {
    const tokenMatch = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase();
      return tokens.every(t => name.includes(t));
    });
    if (tokenMatch) return tokenMatch;
  }

  // 6. Substring match
  const subMatch = skus.find((s: any) => 
    (s.name || '').toLowerCase().includes(query) || 
    (cleanQuery && (s.name || '').toLowerCase().includes(cleanQuery))
  );
  if (subMatch) return subMatch;

  return null;
}

  // Direct order placement using Owner-defined Short Key
  async function handleGameDirectOrder(ctx: MyContext, game: any, shortKey: string, args: string[]) {
    try {
      const gameId = String(game.gameId || game.game_id);
      const gameName = game.name || game.game_name || 'Game';

      const response = await lootbar.getSkus(gameId);
      const skus = response?.data?.items || [];

      if (!skus || skus.length === 0) {
        return ctx.reply(`⚠️ No packages available for *${gameName}* at the moment.`, { parse_mode: 'Markdown' });
      }

      const requiredFields = (skus[0]?.extra_info || []).filter((f: any) => f.required);
      const minFields = requiredFields.length > 0 ? requiredFields.length : 1;

      if (args.length < minFields) {
        let formatHelp = `.${shortKey} <UID> <Product>`;
        let exampleHelp = `.${shortKey} 5123456789 60`;
        if (requiredFields.length === 2) {
          formatHelp = `.${shortKey} <${requiredFields[0].title || 'UID'}> <${requiredFields[1].title || 'ZoneID'}> <Product>`;
          exampleHelp = `.${shortKey} 12345678 2001 86`;
        }
        return ctx.reply(
          `⚡ *${gameName} Quick Top-Up Command*\n\n` +
          `📌 *Format:* \`${formatHelp}\`\n` +
          `💡 *Example:* \`${exampleHelp}\`\n\n` +
          `To view all packages & prices, send: \`.${shortKey}\``,
          { parse_mode: 'Markdown' }
        );
      }

      // Parse account parameters
      const extraInfo: Record<string, string> = {};
      if (requiredFields.length === 0) {
        extraInfo['uid'] = args[0];
      } else {
        for (let i = 0; i < requiredFields.length; i++) {
          const field = requiredFields[i];
          extraInfo[field.name] = args[i];
        }
      }

      // If user provided account details without a product name, show 1-click buttons!
      if (args.length === minFields) {
        ctx.session = {};
        ctx.session.provider = 'lootbar';
        ctx.session.gameId = gameId;
        ctx.session.gameName = gameName;
        ctx.session.extraInfo = extraInfo;
        ctx.session.skus = skus;

        const buttons = skus.map((sku: any, idx: number) => {
          const name = sku.sku_name || 'Unknown Item';
          const price = sku.reseller_price || sku.price ? ` ($${sku.reseller_price || sku.price})` : '';
          return [Markup.button.callback(`${name}${price}`, `lb_s_${idx}`)];
        });
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

        let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

        return ctx.reply(
          `🎮 *${gameName}*\n${infoDesc}\n\n` +
          `👇 ဝယ်ယူလိုသော Package ကို အောက်ပါ Button များမှ ရွေးချယ်နှိပ်ပါ:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
          }
        );
      }

      const rawProductQuery = args.slice(minFields).join(' ').trim();

      ctx.session = {};
      ctx.session.provider = 'lootbar';
      ctx.session.gameId = gameId;
      ctx.session.gameName = gameName;
      ctx.session.extraInfo = extraInfo;
      ctx.session.skus = skus;

      // Match SKU using smart matcher
      const matchedSku = findLootBarSkuMatch(skus, rawProductQuery);

      if (!matchedSku) {
        // Show available packages for quick selection
        const buttons = skus.map((sku: any, idx: number) => {
          const name = sku.sku_name || 'Unknown Item';
          const price = sku.reseller_price || sku.price ? ` ($${sku.reseller_price || sku.price})` : '';
          return [Markup.button.callback(`${name}${price}`, `lb_s_${idx}`)];
        });
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

        let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

        return ctx.reply(
          `⚠️ Package matching \`${rawProductQuery}\` not found.\n\n` +
          `🎮 *${gameName}*\n${infoDesc}\n\n` +
          `Please select from the available packages below:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
          }
        );
      }

      // SKU matched!
      ctx.session.skuId = String(matchedSku.sku_id);
      ctx.session.skuName = matchedSku.sku_name || `${gameName} Item`;
      ctx.session.skuPrice = parseFloat(matchedSku.reseller_price || matchedSku.price || '0');

      // Directly proceed to confirmation
      await showOrderConfirmation(ctx);

    } catch (err: any) {
      console.error('Direct order error:', err);
      return ctx.reply(`❌ Error processing order: ${err.message}`);
    }
  }

  // Display packages & prices for TopupNation product
  async function handleTopupNationPackageList(ctx: MyContext, product: any, shortKey: string) {
    try {
      const productName = product.name || 'Game';
      const skus = (product.skus || []).filter((s: any) => s.available !== false && s.availability !== false);

      if (!skus || skus.length === 0) {
        return ctx.reply(`⚠️ No packages available for *${productName}* from TopupNation.`, { parse_mode: 'Markdown' });
      }

      const requiredFields = (product.fields || []).filter((f: any) => f.required);
      let orderFormatDesc = `.${shortKey} <PlayerID> <Package>`;
      let exampleDesc = `.${shortKey} 123456789 100`;

      if (requiredFields.length === 1) {
        const fName = requiredFields[0].title || requiredFields[0].name || 'PlayerID';
        orderFormatDesc = `.${shortKey} <${fName}> <Package>`;
        exampleDesc = `.${shortKey} 12345678 100`;
      } else if (requiredFields.length >= 2) {
        const f1 = requiredFields[0].title || requiredFields[0].name || 'UserAccount';
        const f2 = requiredFields[1].title || requiredFields[1].name || 'Server';
        orderFormatDesc = `.${shortKey} <${f1}> <${f2}> <Package>`;
        exampleDesc = `.${shortKey} 12345678 2001 100`;
      }

      let msg = `🌐 *${productName} (TopupNation) — Packages & Prices*\n\n` +
        `📦 *ရရှိနိုင်သော Products စာရင်း:*\n`;

      skus.forEach((sku: any) => {
        const name = sku.name || `Package #${sku.sku}`;
        const price = sku.price || '0.00';
        msg += `▫️ *${name}* — \`$${Number(price).toFixed(2)} USD\`\n`;
      });

      msg += `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `🛒 *Order တင်ရန် Command Format:*\n` +
        `\`${orderFormatDesc}\`\n\n` +
        `👉 *ဥပမာ:* \`${exampleDesc}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error('Error fetching TopupNation package list:', err);
      return ctx.reply(`❌ Error fetching package list: ${err.message}`);
    }
  }

  // Direct order placement for TopupNation
  async function handleTopupNationDirectOrder(ctx: MyContext, product: any, shortKey: string, args: string[]) {
    try {
      const productId = String(product.productId);
      const productName = product.name || 'Game';
      const skus = product.skus || [];

      if (!skus || skus.length === 0) {
        return ctx.reply(`⚠️ No packages available for *${productName}*.`, { parse_mode: 'Markdown' });
      }

      const requiredFields = (product.fields || []).filter((f: any) => f.required);
      const minFields = requiredFields.length > 0 ? requiredFields.length : 1;

      if (args.length < minFields) {
        let formatHelp = `.${shortKey} <Account> <Package>`;
        let exampleHelp = `.${shortKey} 123456789 100`;
        if (requiredFields.length === 2) {
          formatHelp = `.${shortKey} <${requiredFields[0].title || 'Account'}> <${requiredFields[1].title || 'Server'}> <Package>`;
          exampleHelp = `.${shortKey} 12345678 2001 100`;
        }
        return ctx.reply(
          `⚡ *${productName} (TopupNation) Quick Order*\n\n` +
          `📌 *Format:* \`${formatHelp}\`\n` +
          `💡 *Example:* \`${exampleHelp}\`\n\n` +
          `To view all packages & prices, send: \`.${shortKey}\``,
          { parse_mode: 'Markdown' }
        );
      }

      // Parse fields
      const extraInfo: Record<string, any> = {};
      if (requiredFields.length === 0) {
        extraInfo['userAccount'] = args[0];
        extraInfo['uid'] = args[0];
      } else {
        for (let i = 0; i < requiredFields.length; i++) {
          const field = requiredFields[i];
          extraInfo[field.name] = args[i];
        }
        if (!extraInfo['userAccount'] && args[0]) {
          extraInfo['userAccount'] = args[0];
        }
        if (!extraInfo['server'] && args[1] && requiredFields.length > 1) {
          extraInfo['server'] = args[1];
        }
      }

      // If user provided account details without a product name, show 1-click buttons!
      if (args.length === minFields) {
        ctx.session = {};
        ctx.session.provider = 'topupnation';
        ctx.session.gameId = productId;
        ctx.session.gameName = productName;
        ctx.session.extraInfo = extraInfo;
        ctx.session.skus = skus;

        const buttons = skus.map((sku: any, idx: number) => {
          const name = sku.name || 'Unknown Item';
          const price = sku.price ? ` ($${sku.price})` : '';
          return [Markup.button.callback(`${name}${price}`, `tpn_s_${idx}`)];
        });
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

        let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

        return ctx.reply(
          `🌐 *${productName} (TopupNation)*\n${infoDesc}\n\n` +
          `👇 ဝယ်ယူလိုသော Package ကို အောက်ပါ Button များမှ ရွေးချယ်နှိပ်ပါ:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
          }
        );
      }

      const rawProductQuery = args.slice(minFields).join(' ').trim();

      ctx.session = {};
      ctx.session.provider = 'topupnation';
      ctx.session.gameId = productId;
      ctx.session.gameName = productName;
      ctx.session.extraInfo = extraInfo;
      ctx.session.skus = skus;

      // Match SKU using smart matcher
      const matchedSku = findTopupNationSkuMatch(skus, rawProductQuery);

      if (!matchedSku) {
        const buttons = skus.map((sku: any, idx: number) => {
          const name = sku.name || 'Unknown Item';
          const price = sku.price ? ` ($${sku.price})` : '';
          return [Markup.button.callback(`${name}${price}`, `tpn_s_${idx}`)];
        });
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

        let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

        return ctx.reply(
          `⚠️ Package matching \`${rawProductQuery}\` not found.\n\n` +
          `🌐 *${productName} (TopupNation)*\n${infoDesc}\n\n` +
          `Please select from the available packages below:`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
          }
        );
      }

      // SKU matched!
      ctx.session.skuId = String(matchedSku.sku);
      ctx.session.skuName = matchedSku.name || `${productName} Package`;
      ctx.session.skuPrice = typeof matchedSku.price === 'number' ? matchedSku.price : parseFloat(String(matchedSku.price || '0'));

      // Directly proceed to confirmation
      await showOrderConfirmation(ctx);

    } catch (err: any) {
      console.error('TopupNation direct order error:', err);
      return ctx.reply(`❌ Error processing order: ${err.message}`);
    }
  }

  // Universal Short Key Listener (e.g. .p, .ml, .ff, /p, etc.)
  bot.hears(/^[./]([a-zA-Z0-9_-]+)(\s+.*)?$/i, async (ctx, next) => {
    const text = ctx.message.text.trim();
    const match = text.match(/^[./]([a-zA-Z0-9_-]+)(\s+.*)?$/i);
    if (!match) return next();

    const inputKey = match[1].toLowerCase();
    const rawArgs = match[2] ? parseCommandArgs(match[2]) : [];

    // Skip reserved commands like /start, /cancel, /auth, /unauth, /users, /addbalance, /orders, /balance, /games, /account, /profile, /wallet, /topup, /deposit, /lootbar, /tpn
    const reservedCommands = ['start', 'cancel', 'auth', 'unauth', 'users', 'addbalance', 'orders', 'balance', 'games', 'gamelist', 'help', 'account', 'profile', 'wallet', 'myaccount', 'mywallet', 'mybalance', 'topup', 'deposit', 'requesttopup', 'requestbalance', 'addmoney', 'lootbar', 'lb', 'tpn', 'topupnation'];
    if (reservedCommands.includes(inputKey)) {
      return next();
    }

    try {
      // Find matching game by shortKey
      let savedGames = await SavedGame.find({});
      let matchedGame = savedGames.find((g: any) => {
        const k = (g.shortKey || getGameDefaultShortKey(g.name, g.gameId)).toLowerCase();
        return k === inputKey || String(g.gameId) === inputKey;
      });

      if (!matchedGame) {
        // Try fallback to LootBar API games if not found
        const response = await lootbar.getGames();
        const allGames = response?.data?.items || [];
        const fallback = allGames.find((g: any) => {
          const gId = String(g.id || g.game_id);
          const gName = g.name || g.game_name || '';
          return getGameDefaultShortKey(gName, gId) === inputKey || gId === inputKey;
        });
        if (fallback) {
          matchedGame = {
            gameId: String(fallback.id || fallback.game_id),
            name: fallback.name || fallback.game_name,
            shortKey: inputKey,
            isEnabled: true
          } as any;
        }
      }

      if (!matchedGame) {
        // Try matching TopupNation products by shortKey
        const tpnProducts = await TopupNationProduct.find({});
        const matchedTpn = tpnProducts.find((p: any) => {
          const k = (p.shortKey || '').toLowerCase();
          return k === inputKey || String(p.productId).toLowerCase() === inputKey;
        });

        if (matchedTpn) {
          if (matchedTpn.isEnabled === false || matchedTpn.status === 'DISABLED') {
            return ctx.reply(`⚠️ *${matchedTpn.name}* is currently disabled by Admin.`, { parse_mode: 'Markdown' });
          }

          const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();
          if (rawArgs.length === 0) {
            return await handleTopupNationPackageList(ctx, matchedTpn, activeShortKey);
          } else {
            return await handleTopupNationDirectOrder(ctx, matchedTpn, activeShortKey, rawArgs);
          }
        }

        return next(); // Not a game short key, pass along
      }

      if (matchedGame.isEnabled === false) {
        return ctx.reply(`⚠️ *${matchedGame.name}* is currently disabled by Admin.`, { parse_mode: 'Markdown' });
      }

      const activeShortKey = (matchedGame.shortKey || inputKey).toLowerCase();

      if (rawArgs.length === 0) {
        // User sent just .<shortKey> -> Show package list & prices
        return await handleGamePackageList(ctx, matchedGame, activeShortKey);
      } else {
        // User sent .<shortKey> <args...> -> Direct order
        return await handleGameDirectOrder(ctx, matchedGame, activeShortKey, rawArgs);
      }
    } catch (err: any) {
      console.error('Short key processing error:', err);
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  bot.action(/^lb_s_(\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    try {
      const skus = ctx.session.skus || [];
      const selectedSku = skus[idx];
      if (!selectedSku) {
        return ctx.reply('⚠️ Session expired. Please type the command again.');
      }
      ctx.session.provider = 'lootbar';
      ctx.session.skuId = String(selectedSku.sku_id);
      ctx.session.skuName = selectedSku.sku_name || 'Item';
      ctx.session.skuPrice = parseFloat(selectedSku.reseller_price || selectedSku.price || '0');
      await showOrderConfirmation(ctx);
    } catch (err: any) {
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  bot.action(/^tpn_s_(\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    try {
      const skus = ctx.session.skus || [];
      const sku = skus[idx];
      if (!sku) {
        return ctx.reply('⚠️ Session expired. Please type the command again.');
      }
      ctx.session.provider = 'topupnation';
      ctx.session.skuId = String(sku.sku);
      ctx.session.skuName = sku.name || 'Package';
      ctx.session.skuPrice = typeof sku.price === 'number' ? sku.price : parseFloat(String(sku.price || '0'));
      await showOrderConfirmation(ctx);
    } catch (err: any) {
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  bot.action(/^q_order_(.+?)_(.+)$/, async (ctx) => {
    const gameId = ctx.match[1];
    const skuId = ctx.match[2];
    await ctx.answerCbQuery();

    try {
      const response = await lootbar.getSkus(gameId);
      const skus = response?.data?.items || [];
      const selectedSku = skus.find((s: any) => String(s.sku_id) === String(skuId));
      if (!selectedSku) {
        return ctx.reply('⚠️ Selected SKU not found.');
      }

      const savedGame = await SavedGame.findOne({ gameId });
      const gameName = savedGame?.name || selectedSku.game_name || 'Game';

      ctx.session.provider = 'lootbar';
      ctx.session.gameId = gameId;
      ctx.session.gameName = gameName;
      ctx.session.skuId = String(selectedSku.sku_id);
      ctx.session.skuName = selectedSku.sku_name || 'Item';
      ctx.session.skuPrice = parseFloat(selectedSku.reseller_price || selectedSku.price || '0');

      await showOrderConfirmation(ctx);
    } catch (err: any) {
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  bot.action(/^tpn_q_order_(.+?)_(.+)$/, async (ctx) => {
    const productId = ctx.match[1];
    const skuId = ctx.match[2];
    await ctx.answerCbQuery();

    try {
      const product = await TopupNationProduct.findOne({ productId });
      if (!product) {
        return ctx.reply('⚠️ TopupNation product not found.');
      }

      const sku = (product.skus || []).find((s: any) => String(s.sku) === String(skuId));
      if (!sku) {
        return ctx.reply('⚠️ Selected SKU not found in TopupNation catalog.');
      }

      ctx.session.provider = 'topupnation';
      ctx.session.gameId = productId;
      ctx.session.gameName = product.name;
      ctx.session.skuId = String(sku.sku);
      ctx.session.skuName = sku.name || 'Package';
      ctx.session.skuPrice = typeof sku.price === 'number' ? sku.price : parseFloat(String(sku.price || '0'));

      await showOrderConfirmation(ctx);
    } catch (err: any) {
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // TopupNation Games & Products Catalog Command
  bot.command(['tpn', 'topupnation'], async (ctx) => {
    try {
      const products = await TopupNationProduct.find({}).sort({ name: 1 });
      if (products.length === 0) {
        return ctx.reply(
          `🌐 *TopupNation Provider Catalog*\n\n` +
          `No TopupNation products are currently synced. Please sync products in the Admin Panel.`,
          { parse_mode: 'Markdown' }
        );
      }

      let msg = `🌐 *TopupNation Games & Products*\n\n` +
        `ရရှိနိုင်သော Games များကိုကြည့်ရန် သက်ဆိုင်ရာ Short Key ကို ပို့ပေးပါ:\n\n`;

      products.forEach((p: any) => {
        const sk = p.shortKey || `t${p.productId.slice(0, 4)}`;
        msg += `🎮 *${p.name}* ➔ \`.${sk}\`\n`;
      });

      msg += `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 *ဥပမာ:* \`.${products[0]?.shortKey || 'tp'}\` ပို့ပြီး Package စာရင်းနှင့် ဈေးနှုန်းကြည့်နိုင်ပါသည်။\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      return ctx.reply(`❌ Error fetching TopupNation list: ${err.message}`);
    }
  });

  bot.action(/^quick_p_(.+?)_(.+)$/, async (ctx) => {
    const uid = ctx.match[1];
    const skuId = ctx.match[2];
    await ctx.answerCbQuery();

    try {
      const response = await lootbar.getSkus('1004');
      const skus = response?.data?.items || [];
      const selectedSku = skus.find((s: any) => String(s.sku_id) === String(skuId));
      if (!selectedSku) {
        return ctx.reply('⚠️ Selected SKU not found.');
      }

      ctx.session = {};
      ctx.session.gameId = '1004';
      ctx.session.gameName = 'PUBG Mobile';
      ctx.session.skuId = String(selectedSku.sku_id);
      ctx.session.skuName = selectedSku.sku_name || 'PUBG Item';
      ctx.session.skuPrice = parseFloat(selectedSku.reseller_price || selectedSku.price || '0');
      ctx.session.extraInfo = { uid };

      await showOrderConfirmation(ctx);
    } catch (err: any) {
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // Admin Commands
  bot.command('auth', async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat.id) !== currentAdminId) return;
    const parts = ctx.message.text.split(' ');
    const targetId = parts[1];
    if (!targetId) return ctx.reply('Usage: /auth <chatId>');
    await User.findOneAndUpdate({ telegramChatId: Number(targetId) }, { isAuthorized: true }, { upsert: true });
    return ctx.reply(`✅ User ${targetId} authorized.`);
  });

  bot.command('unauth', async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat.id) !== currentAdminId) return;
    const parts = ctx.message.text.split(' ');
    const targetId = parts[1];
    if (!targetId) return ctx.reply('Usage: /unauth <chatId>');
    await User.findOneAndUpdate({ telegramChatId: Number(targetId) }, { isAuthorized: false }, { upsert: true });
    return ctx.reply(`✅ User ${targetId} unauthorized.`);
  });

  bot.command('users', async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat.id) !== currentAdminId) return;
    const users = await User.find({ isAuthorized: true });
    if (users.length === 0) return ctx.reply('No authorized users found.');
    let msg = '👥 *Authorized Users*\n\n';
    users.forEach(u => {
      msg += `- \`${u.telegramChatId}\` (Balance: $${u.balance})\n`;
    });
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.command('addbalance', async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat.id) !== currentAdminId) return;
    const parts = ctx.message.text.split(' ');
    const targetId = parts[1];
    const amount = Number(parts[2]);
    if (!targetId || isNaN(amount)) return ctx.reply('Usage: /addbalance <chatId> <amount>');
    const user = await User.findOneAndUpdate({ telegramChatId: Number(targetId) }, { $inc: { balance: amount } }, { new: true, upsert: true });
    return ctx.reply(`✅ Added ${amount} to user ${targetId}. New balance: ${user?.balance}`);
  });

  // Admin Action: Approve User
  bot.action(/^approve_user_(.+)$/, async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat?.id) !== currentAdminId) {
        return ctx.answerCbQuery('Unauthorized', { show_alert: true });
    }
    const targetId = ctx.match[1];
    await User.findOneAndUpdate({ telegramChatId: Number(targetId) }, { isAuthorized: true }, { upsert: true });
    await ctx.editMessageText(`✅ User ${targetId} has been authorized.`);
    
    // Notify the user
    try {
        await bot.telegram.sendMessage(targetId, '🎉 Good news! You have been authorized by the admin.\n\nSend /start to begin using the bot.');
    } catch (e) {
        console.error('Failed to notify user of approval', e);
    }
  });

  // Admin Action: Reject User
  bot.action(/^reject_user_(.+)$/, async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat?.id) !== currentAdminId) {
        return ctx.answerCbQuery('Unauthorized', { show_alert: true });
    }
    const targetId = ctx.match[1];
    await ctx.editMessageText(`❌ User ${targetId} request rejected.`);
  });

  // Admin Action: Approve Balance Top-Up Request
  bot.action(/^topup_approve_(TR-[A-Z0-9]+)$/, async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    const clickerChatId = String(ctx.chat?.id || ctx.from?.id);

    if (clickerChatId !== currentAdminId) {
      return ctx.answerCbQuery('🚫 Unauthorized (Owner only)', { show_alert: true });
    }

    const requestId = ctx.match[1];
    const topupReq = await TopupRequest.findOne({ requestId });

    if (!topupReq) {
      return ctx.answerCbQuery('⚠️ Top-up request not found.', { show_alert: true });
    }

    if (topupReq.status !== 'pending') {
      return ctx.answerCbQuery(`ℹ️ This request was already ${topupReq.status}.`, { show_alert: true });
    }

    topupReq.status = 'approved';
    topupReq.processedBy = clickerChatId;
    topupReq.processedAt = new Date();
    await topupReq.save();

    // Increment user's wallet balance
    const updatedUser = await User.findOneAndUpdate(
      { telegramChatId: topupReq.telegramChatId },
      { $inc: { balance: topupReq.amount } },
      { new: true }
    );

    await ctx.answerCbQuery('✅ Top-up approved & balance added!');
    
    const approvedMsg = `✅ *Top-Up Request Approved!*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 👤 User: \`${topupReq.telegramChatId}\`\n` +
      `├── 💵 Amount Added: \`+$${topupReq.amount.toFixed(2)} USD\`\n` +
      `├── 💳 User New Balance: \`$${Number(updatedUser?.balance || 0).toFixed(2)} USD\`\n` +
      `├── 👤 Approved by: \`Admin / Owner\`\n` +
      `└── 📅 Time: \`${new Date().toLocaleTimeString()}\`\n` +
      `═════════════════════════`;

    await safeEditMessageCaption(ctx, approvedMsg);

    // Notify user in their Telegram chat
    const userSuccessMsg = `🎉 *Balance Top-Up Approved!*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 💰 Added Amount: \`+$${topupReq.amount.toFixed(2)} USD\`\n` +
      `├── 💳 New Wallet Balance: \`$${Number(updatedUser?.balance || 0).toFixed(2)} USD\`\n` +
      `└── ✅ Status: *APPROVED*\n` +
      `═════════════════════════\n` +
      `သင့် Wallet ထဲသို့ ငွေဖြည့်သွင်းခြင်း အောင်မြင်ပါပြီ။ အော်ဒါများကို စတင်ဝယ်ယူနိုင်ပါပြီ။`;

    await safeSendMessage(bot.telegram, topupReq.telegramChatId, userSuccessMsg, mainMenu);
  });

  // Admin Action: Reject Balance Top-Up Request
  bot.action(/^topup_reject_(TR-[A-Z0-9]+)$/, async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    const clickerChatId = String(ctx.chat?.id || ctx.from?.id);

    if (clickerChatId !== currentAdminId) {
      return ctx.answerCbQuery('🚫 Unauthorized (Owner only)', { show_alert: true });
    }

    const requestId = ctx.match[1];
    const topupReq = await TopupRequest.findOne({ requestId });

    if (!topupReq) {
      return ctx.answerCbQuery('⚠️ Top-up request not found.', { show_alert: true });
    }

    if (topupReq.status !== 'pending') {
      return ctx.answerCbQuery(`ℹ️ This request was already ${topupReq.status}.`, { show_alert: true });
    }

    topupReq.status = 'rejected';
    topupReq.processedBy = clickerChatId;
    topupReq.processedAt = new Date();
    await topupReq.save();

    await ctx.answerCbQuery('❌ Top-up request declined.');
    
    const rejectedMsg = `❌ *Top-Up Request Declined*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 👤 User: \`${topupReq.telegramChatId}\`\n` +
      `├── 💵 Amount: \`$${topupReq.amount.toFixed(2)} USD\`\n` +
      `├── 👤 Declined by: \`Admin / Owner\`\n` +
      `└── 📅 Time: \`${new Date().toLocaleTimeString()}\`\n` +
      `═════════════════════════`;

    await safeEditMessageCaption(ctx, rejectedMsg);

    // Notify user
    const userRejectMsg = `❌ *Top-Up Request Declined*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 💰 Amount: \`$${topupReq.amount.toFixed(2)} USD\`\n` +
      `└── ❌ Status: *DECLINED*\n` +
      `═════════════════════════\n` +
      `Admin မှ ငွေဖြည့်သွင်းမှုအား ပယ်ဖျက်လိုက်ပါသည်။ အသေးစိတ်သိရှိလိုပါက Admin သို့ ဆက်သွယ်ပါ။`;

    await safeSendMessage(bot.telegram, topupReq.telegramChatId, userRejectMsg, mainMenu);
  });

  // Live API Balance Fetching Helpers
  async function getLootBarLiveBalance(): Promise<{ success: boolean; balance: string; error?: string }> {
    try {
      if (!lootbar || !lootbar.isConfigured()) {
        return { success: false, balance: '0.00', error: 'Credentials not configured' };
      }
      const asset = await lootbar.queryAsset();
      const bal = asset?.data?.total_amount || asset?.data?.balance || '0.00';
      return { success: true, balance: Number(bal).toFixed(2) };
    } catch (e: any) {
      return { success: false, balance: '0.00', error: e.message || 'Connection error' };
    }
  }

  async function getTopupNationLiveBalance(): Promise<{ success: boolean; balance: string; available: string; currency: string; error?: string }> {
    try {
      if (!topupNation || !topupNation.getClient()?.isConfigured()) {
        return { success: false, balance: '0.00', available: '0.00', currency: 'USD', error: 'Credentials not configured' };
      }
      const data = await topupNation.getWalletBalance();
      const bal = typeof data?.balance === 'number' ? data.balance : parseFloat(data?.balance || '0');
      const avail = typeof data?.availableBalance === 'number' ? data.availableBalance : (data?.availableBalance ? parseFloat(data.availableBalance) : bal);
      return {
        success: true,
        balance: bal.toFixed(2),
        available: avail.toFixed(2),
        currency: data?.currency || 'USD'
      };
    } catch (e: any) {
      return { success: false, balance: '0.00', available: '0.00', currency: 'USD', error: e.message || 'Connection error' };
    }
  }

  async function renderDualApiBalance(ctx: MyContext, viewMode: 'both' | 'lootbar' | 'topupnation' = 'both', isEdit: boolean = false) {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    const currentAdminId = await getAdminChatId(adminChatId);
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user?.useDirectApiBalance || user?.balanceMode === 'api');

    // Security & Privacy Check: Non-API-linked members cannot access API balances
    if (!isApiLinked && !isOwner) {
      const msg = `🔒 *Access Restricted: API Balance*\n\n` +
        `တိုက်ရိုက် API Balance စစ်ဆေးခြင်းကို Direct API Linked Reseller (VIP) သို့မဟုတ် Admin သာ ကြည့်ရှုခွင့်ရှိပါသည်။\n\n` +
        `💰 *သင့် Wallet လက်ကျန်ငွေ:* \`$${Number(user?.balance || 0).toFixed(2)} USD\``;

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

    if (viewMode === 'lootbar') {
      const lbRes = await getLootBarLiveBalance();
      const msg = `🎮 *LootBar API Live Asset Balance*\n` +
        `═════════════════════════\n` +
        `├── 🌐 Provider: \`LootBar API\`\n` +
        `├── 💰 Live Asset Balance: \`$${lbRes.balance} USD\`\n` +
        `├── 📊 Connection Status: \`${lbRes.success ? '✅ Live Connected' : '⚠️ Offline'}\`\n` +
        (!lbRes.success && lbRes.error ? `├── ⚠️ Note: \`${escapeMd(lbRes.error)}\`\n` : '') +
        `└── 🕒 Synced At: \`${formatMyanmarDateTime(new Date())}\`\n` +
        `═════════════════════════\n` +
        `✨ _LootBar API Wallet မှ လက်ကျန်ငွေ အခြေအနေ ဖြစ်ပါသည်။_`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🔄 Refresh LootBar', 'api_bal_lootbar'),
          Markup.button.callback('🌐 Switch to TopupNation', 'api_bal_topupnation')
        ],
        [
          Markup.button.callback('📊 View Both APIs', 'api_bal_both'),
          Markup.button.callback('💰 Request Top-Up', 'topup_flow_start')
        ],
        [
          Markup.button.callback('👤 My Account Profile', 'view_my_profile')
        ]
      ]);

      if (isEdit) {
        return await safeEditMessageText(ctx, msg, keyboard);
      } else {
        return await safeReply(ctx, msg, keyboard);
      }
    }

    if (viewMode === 'topupnation') {
      const tpnRes = await getTopupNationLiveBalance();
      const msg = `🌐 *TopupNation API Live Wallet Balance*\n` +
        `═════════════════════════\n` +
        `├── 🌐 Provider: \`TopupNation Reseller API\`\n` +
        `├── 💰 Total Balance: \`$${tpnRes.balance} ${tpnRes.currency}\`\n` +
        `├── 💵 Available Balance: \`$${tpnRes.available} ${tpnRes.currency}\`\n` +
        `├── 📊 Connection Status: \`${tpnRes.success ? '✅ Live Connected' : '⚠️ Offline'}\`\n` +
        (!tpnRes.success && tpnRes.error ? `├── ⚠️ Note: \`${escapeMd(tpnRes.error)}\`\n` : '') +
        `└── 🕒 Synced At: \`${formatMyanmarDateTime(new Date())}\`\n` +
        `═════════════════════════\n` +
        `✨ _TopupNation Reseller API Wallet မှ လက်ကျန်ငွေ ဖြစ်ပါသည်။_`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🔄 Refresh TopupNation', 'api_bal_topupnation'),
          Markup.button.callback('🎮 Switch to LootBar', 'api_bal_lootbar')
        ],
        [
          Markup.button.callback('📊 View Both APIs', 'api_bal_both'),
          Markup.button.callback('💰 Request Top-Up', 'topup_flow_start')
        ],
        [
          Markup.button.callback('👤 My Account Profile', 'view_my_profile')
        ]
      ]);

      if (isEdit) {
        return await safeEditMessageText(ctx, msg, keyboard);
      } else {
        return await safeReply(ctx, msg, keyboard);
      }
    }

    // Default: Both APIs
    const [lbRes, tpnRes] = await Promise.all([
      getLootBarLiveBalance(),
      getTopupNationLiveBalance()
    ]);

    const msg = `⚡ *API Live Balance Overview (API နှစ်ခုလုံး လက်ကျန်ငွေ)*\n` +
      `═════════════════════════\n` +
      `🎮 *1. LootBar API:*\n` +
      `├── 💰 Total Asset: \`$${lbRes.balance} USD\`\n` +
      `└── 📊 Status: \`${lbRes.success ? '✅ Live Connected' : `⚠️ Offline (${escapeMd(lbRes.error)})`}\`\n\n` +
      `🌐 *2. TopupNation API:*\n` +
      `├── 💰 Total Balance: \`$${tpnRes.balance} ${tpnRes.currency}\`\n` +
      `├── 💵 Available: \`$${tpnRes.available} ${tpnRes.currency}\`\n` +
      `└── 📊 Status: \`${tpnRes.success ? '✅ Live Connected' : `⚠️ Offline (${escapeMd(tpnRes.error)})`}\`\n` +
      `═════════════════════════\n` +
      `💡 _အောက်ပါ ခလုတ်များဖြင့် API တစ်ခုချင်းစီ သီးသန့် ရွေးချယ်စစ်ဆေးနိုင်ပါသည်:_`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🎮 LootBar Balance', 'api_bal_lootbar'),
        Markup.button.callback('🌐 TopupNation Balance', 'api_bal_topupnation')
      ],
      [
        Markup.button.callback('🔄 Refresh Both APIs', 'api_bal_both'),
        Markup.button.callback('💰 Request Top-Up', 'topup_flow_start')
      ],
      [
        Markup.button.callback('👤 My Account Profile', 'view_my_profile')
      ]
    ]);

    if (isEdit) {
      return await safeEditMessageText(ctx, msg, keyboard);
    } else {
      return await safeReply(ctx, msg, keyboard);
    }
  }

  async function renderAccountProfile(ctx: MyContext, isEdit: boolean = false) {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    if (!user) return ctx.reply('User not found.');
    
    const currentAdminId = await getAdminChatId(adminChatId);
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user.useDirectApiBalance || user.balanceMode === 'api');
    const apiProvider = (user.apiProvider || 'both').toUpperCase();

    const usernameDisplay = user.username 
      ? `@${escapeMd(user.username)}` 
      : user.firstName 
        ? escapeMd(user.firstName) 
        : 'Not set';

    // Standard Member Profile (Hide API balances completely)
    if (!isApiLinked && !isOwner) {
      let msg = `👤 *My Account Profile*\n` +
        `═════════════════════════\n` +
        `🆔 *Chat ID:* \`${ctx.chat!.id}\`\n` +
        `👤 *Username:* ${usernameDisplay}\n` +
        `📊 *Status:* ✅ \`Authorized\`\n` +
        `⚡ *Account Tier:* \`Standard Member\`\n` +
        `💰 *Wallet Balance:* \`$${Number(user.balance || 0).toFixed(2)} USD\`\n` +
        `📦 *Ordering Mode:* \`Pre-funded Wallet Balance\`\n` +
        `═════════════════════════`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('💰 Request Balance Top-Up', 'topup_flow_start'),
          Markup.button.callback('📜 Order History', 'view_my_orders')
        ]
      ]);

      if (isEdit) {
        return await safeEditMessageText(ctx, msg, keyboard);
      } else {
        return await safeReply(ctx, msg, keyboard);
      }
    }

    // Direct API Linked VIP or Owner Profile
    const [lbRes, tpnRes] = await Promise.all([
      getLootBarLiveBalance(),
      getTopupNationLiveBalance()
    ]);

    let msg = `👤 *My Account Profile*\n` +
      `═════════════════════════\n` +
      `🆔 *Chat ID:* \`${ctx.chat!.id}\`\n` +
      `👤 *Username:* ${usernameDisplay}\n` +
      `📊 *Status:* ✅ \`Authorized\`\n`;

    if (isApiLinked) {
      msg += `⚡ *Account Tier:* \`Direct API Linked (VIP / Reseller)\`\n` +
        `🌐 *Linked Provider:* \`${apiProvider}\`\n` +
        `💳 *Wallet Mode:* \`Direct API Live Balance (Auto-Sync)\`\n\n` +
        `🎮 *LootBar API Live:* \`$${lbRes.balance} USD\`\n` +
        `🌐 *TopupNation API Live:* \`$${tpnRes.balance} USD\`\n\n` +
        `_✨ Your account is directly connected to live API funds for instant top-up fulfillment._`;
    } else {
      msg += `⚡ *Account Tier:* \`Admin / Owner\`\n` +
        `💰 *Wallet Balance:* \`$${Number(user.balance || 0).toFixed(2)} USD\`\n\n` +
        `🎮 *LootBar API Live:* \`$${lbRes.balance} USD\`\n` +
        `🌐 *TopupNation API Live:* \`$${tpnRes.balance} USD\``;
    }
    
    if (isOwner) {
      msg += `\n\n👑 *Owner Access:* \`Full API Admin\``;
    }
    msg += `\n═════════════════════════`;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🎮 LootBar Balance', 'api_bal_lootbar'),
        Markup.button.callback('🌐 TopupNation Balance', 'api_bal_topupnation')
      ],
      [
        Markup.button.callback('📊 Both API Balances', 'api_bal_both'),
        Markup.button.callback('💰 Request Top-Up', 'topup_flow_start')
      ]
    ]);

    if (isEdit) {
      return await safeEditMessageText(ctx, msg, keyboard);
    } else {
      return await safeReply(ctx, msg, keyboard);
    }
  }

  async function renderBalance(ctx: MyContext, isEdit: boolean = false) {
    const currentAdminId = await getAdminChatId(adminChatId);
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user?.useDirectApiBalance || user?.balanceMode === 'api');
    const apiProvider = (user?.apiProvider || 'both').toUpperCase();

    // Standard Member: ONLY show personal wallet balance (Hide API balances completely)
    if (!isApiLinked && !isOwner) {
      let msg = `💳 *Your Wallet Balance*\n` +
        `═════════════════════════\n` +
        `💰 *Current Balance:* \`$${Number(user?.balance || 0).toFixed(2)} USD\`\n` +
        `⚡ *Account Tier:* \`Standard Member\`\n` +
        `📦 *Ordering Mode:* \`Pre-funded Wallet Balance\`\n` +
        `═════════════════════════\n` +
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

    // Direct API Linked VIP or Owner: Show Live API Balances
    const [lbRes, tpnRes] = await Promise.all([
      getLootBarLiveBalance(),
      getTopupNationLiveBalance()
    ]);

    let msg = `⚡ *Direct API Live Balance (VIP / Reseller)*\n` +
      `═════════════════════════\n` +
      `💰 *Personal Wallet:* \`$${Number(user?.balance || 0).toFixed(2)} USD\`\n` +
      `🌐 *Linked Provider:* \`${apiProvider}\`\n` +
      `═════════════════════════\n` +
      `🎮 *LootBar API:* \`$${lbRes.balance} USD\` (${lbRes.success ? '✅ Connected' : '⚠️ Offline'})\n` +
      `🌐 *TopupNation API:* \`$${tpnRes.balance} USD\` (${tpnRes.success ? '✅ Connected' : '⚠️ Offline'})\n` +
      `═════════════════════════\n` +
      `💡 _API Balance တစ်ခုချင်းစီကို သီးသန့် ရွေးချယ်ကြည့်ရှုလိုပါက အောက်ပါခလုတ်များကို နှိပ်ပါ:_`;

    const keyboard = Markup.inlineKeyboard([
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
    ]);

    if (isEdit) {
      return await safeEditMessageText(ctx, msg, keyboard);
    } else {
      return await safeReply(ctx, msg, keyboard);
    }
  }

  // Action Handlers for API Balance Switcher
  bot.action('api_bal_both', async (ctx) => {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    const currentAdminId = await getAdminChatId(adminChatId);
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user?.useDirectApiBalance || user?.balanceMode === 'api');

    if (!isApiLinked && !isOwner) {
      return await ctx.answerCbQuery('⚠️ API balance access is only for API-linked VIP members.', { show_alert: true });
    }

    await ctx.answerCbQuery('Refreshing both API balances...');
    return await renderDualApiBalance(ctx, 'both', true);
  });

  bot.action('api_bal_lootbar', async (ctx) => {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    const currentAdminId = await getAdminChatId(adminChatId);
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user?.useDirectApiBalance || user?.balanceMode === 'api');

    if (!isApiLinked && !isOwner) {
      return await ctx.answerCbQuery('⚠️ API balance access is only for API-linked VIP members.', { show_alert: true });
    }

    await ctx.answerCbQuery('Checking LootBar API balance...');
    return await renderDualApiBalance(ctx, 'lootbar', true);
  });

  bot.action('api_bal_topupnation', async (ctx) => {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    const currentAdminId = await getAdminChatId(adminChatId);
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user?.useDirectApiBalance || user?.balanceMode === 'api');

    if (!isApiLinked && !isOwner) {
      return await ctx.answerCbQuery('⚠️ API balance access is only for API-linked VIP members.', { show_alert: true });
    }

    await ctx.answerCbQuery('Checking TopupNation API balance...');
    return await renderDualApiBalance(ctx, 'topupnation', true);
  });

  bot.action('view_my_balance', async (ctx) => {
    await ctx.answerCbQuery();
    return await renderBalance(ctx, true);
  });

  bot.action('view_my_profile', async (ctx) => {
    await ctx.answerCbQuery();
    return await renderAccountProfile(ctx, true);
  });

  bot.action('view_my_orders', async (ctx) => {
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx);
  });

  bot.hears([
    '👤 My Account', 'My Account', 'Account', 'account', '👤 Profile', 'Profile', 'profile', '👤 My Profile'
  ], async (ctx) => {
    return await renderAccountProfile(ctx);
  });

  bot.command(['account', 'profile', 'myaccount', 'myprofile'], async (ctx) => {
    return await renderAccountProfile(ctx);
  });

  bot.hears([
    '💳 Check Balance', '💳 My Balance', 'My Balance', 'Balance', 'balance', 
    'Wallet', 'wallet', '💳 Wallet', '💰 Balance', 'API Balance', 'api balance', 
    'API Balance စစ်မည်', 'လက်ကျန်ငွေ', 'လက်ကျန်ငွေ စစ်မည်'
  ], async (ctx) => {
    return await renderBalance(ctx);
  });

  bot.command([
    'balance', 'wallet', 'mybalance', 'mywallet', 'checkbalance',
    'apibalance', 'apibal', 'apis', 'api', 'adminbalance',
    'lootbarbalance', 'lbbalance', 'tpnbalance', 'topupnationbalance'
  ], async (ctx) => {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    const currentAdminId = await getAdminChatId(adminChatId);
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user?.useDirectApiBalance || user?.balanceMode === 'api');

    const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '').toLowerCase();

    // If a regular user calls API-specific balance commands, enforce permissions
    if (text.includes('lootbar') || text.includes('lbbalance')) {
      if (!isApiLinked && !isOwner) {
        return await renderBalance(ctx);
      }
      return await renderDualApiBalance(ctx, 'lootbar');
    }
    if (text.includes('tpn') || text.includes('topupnation')) {
      if (!isApiLinked && !isOwner) {
        return await renderBalance(ctx);
      }
      return await renderDualApiBalance(ctx, 'topupnation');
    }
    if (text.includes('apibalance') || text.includes('apis') || text.startsWith('/api')) {
      if (!isApiLinked && !isOwner) {
        return await renderBalance(ctx);
      }
      return await renderDualApiBalance(ctx, 'both');
    }
    return await renderBalance(ctx);
  });

  // Top-up Request Flow Functions
  async function startTopupRequest(ctx: MyContext) {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    if (!user) return ctx.reply('User account not found.');

    ctx.session = {
      step: 'INPUT_TOPUP_AMOUNT'
    };

    const isApiLinked = !!(user.useDirectApiBalance || user.balanceMode === 'api');
    let intro = `💰 *Request Balance Top-Up*\n\n`;
    if (isApiLinked) {
      intro += `⚡ *Account Tier:* \`Direct API Linked (VIP)\`\n_Note: Your account is currently linked to live API funds, but you can also request wallet balance if needed._\n\n`;
    } else {
      intro += `💳 *Current Wallet Balance:* \`$${Number(user.balance || 0).toFixed(2)} USD\`\n\n`;
    }

    intro += `ကျေးဇူးပြု၍ ထည့်သွင်းလိုသော USD ပမာဏကို ရွေးချယ်ပါ (သို့မဟုတ် စာရိုက်ထည့်ပါ - ဥပမာ \`15\`, \`30\`, \`100\`):`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('💵 $5', 'topup_preset_5'),
        Markup.button.callback('💵 $10', 'topup_preset_10'),
        Markup.button.callback('💵 $20', 'topup_preset_20')
      ],
      [
        Markup.button.callback('💵 $50', 'topup_preset_50'),
        Markup.button.callback('💵 $100', 'topup_preset_100'),
        Markup.button.callback('💵 $200', 'topup_preset_200')
      ],
      [
        Markup.button.callback('✏️ Custom Amount (တိုက်ရိုက်ရိုက်ထည့်မည်)', 'topup_custom')
      ],
      [
        Markup.button.callback('❌ Cancel', 'cancel_topup')
      ]
    ]);

    return await safeReply(ctx, intro, keyboard);
  }

  async function submitTopupRequest(ctx: MyContext, amount: number, note: string = '', photoFileId?: string) {
    ctx.session = {};
    const chatId = ctx.chat!.id;
    const user = await User.findOne({ telegramChatId: chatId });
    if (!user) return ctx.reply('User account not found.');

    const requestId = 'TR-' + uuidv4().replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
    const fromUsername = ctx.from?.username || (ctx.chat as any)?.username || undefined;
    const fromFirstName = ctx.from?.first_name || (ctx.chat as any)?.first_name || undefined;

    try {
      await TopupRequest.create({
        requestId,
        telegramChatId: chatId,
        username: fromUsername,
        firstName: fromFirstName,
        amount,
        note: note.trim(),
        photoFileId: photoFileId || '',
        status: 'pending'
      });
    } catch (e) {
      console.error('Failed to create TopupRequest record:', e);
    }

    // Confirmation message to User
    const userConfirmMsg = `✅ *Top-Up Request Submitted!*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 💰 Requested Amount: \`$${amount.toFixed(2)} USD\`\n` +
      `├── 📸 Payment Slip: \`Attached ✅\`\n` +
      (note ? `├── 📝 Note / Ref: \`${escapeCode(note)}\`\n` : '') +
      `├── 💳 Current Balance: \`$${Number(user.balance || 0).toFixed(2)} USD\`\n` +
      `├── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\`\n` +
      `└── ⏳ Status: *PENDING APPROVAL*\n` +
      `═════════════════════════\n` +
      `Admin / Owner ထံသို့ ငွေလွှဲပြေစာနှင့်တကွ တိုက်ရိုက် အကြောင်းကြားစာ ပို့ပြီးပါပြီ။ Owner မှ စစ်ဆေးအတည်ပြုပြီးပါက သင့် Wallet ထဲသို့ Balance တိုက်ရိုက်ထည့်သွင်းပေးပါမည်။`;

    await safeReply(ctx, userConfirmMsg, mainMenu);

    // Notify Owner ONLY
    const currentAdminId = await getAdminChatId(adminChatId);
    const userDisplay = fromUsername ? `@${escapeMd(fromUsername)}` : (fromFirstName ? escapeMd(fromFirstName) : 'User');
    const safeNote = note ? escapeCode(note) : 'None';

    const adminNotificationCaption = `🔔 *New Balance Top-Up Request!*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 👤 User: \`${chatId}\` (${userDisplay})\n` +
      `├── 💵 Requested Amount: \`$${amount.toFixed(2)} USD\`\n` +
      `├── 💳 Current Balance: \`$${Number(user.balance || 0).toFixed(2)} USD\`\n` +
      `├── 📝 Note / Ref: \`${safeNote}\`\n` +
      `└── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\`\n` +
      `═════════════════════════\n` +
      `အောက်ပါ ခလုတ်များကို နှိပ်၍ အတည်ပြု/ပယ်ဖျက်နိုင်ပါသည်:`;

    const adminKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`✅ Approve (+$${amount.toFixed(2)})`, `topup_approve_${requestId}`),
        Markup.button.callback(`❌ Decline`, `topup_reject_${requestId}`)
      ]
    ]);

    if (currentAdminId) {
      if (photoFileId) {
        await safeSendPhoto(bot.telegram, currentAdminId, photoFileId, {
          caption: adminNotificationCaption,
          reply_markup: adminKeyboard.reply_markup
        });
      } else {
        await safeSendMessage(bot.telegram, currentAdminId, adminNotificationCaption, adminKeyboard);
      }
    }
  }

  bot.hears([
    '💰 Request Top-Up', 
    'Request Top-Up', 
    'Request Topup', 
    'Top-up', 
    'Topup', 
    '💰 Request Balance Top-up', 
    'Request Balance Top-up', 
    'Request Balance Topup',
    'Top Up', 
    '💰 Top-Up', 
    '💰 Top Up', 
    'Request Top Up'
  ], async (ctx) => {
    return await startTopupRequest(ctx);
  });

  bot.command(['topup', 'deposit', 'requesttopup', 'requestbalance'], async (ctx) => {
    return await startTopupRequest(ctx);
  });

  bot.action('topup_flow_start', async (ctx) => {
    await ctx.answerCbQuery();
    return await startTopupRequest(ctx);
  });

  bot.action(/^topup_preset_(\d+(\.\d+)?)$/, async (ctx) => {
    const amount = parseFloat(ctx.match[1]);
    if (isNaN(amount) || amount <= 0) {
      return ctx.answerCbQuery('Invalid amount');
    }

    ctx.session.topupAmount = amount;
    ctx.session.step = 'INPUT_TOPUP_PHOTO';

    await ctx.answerCbQuery(`Selected $${amount.toFixed(2)} USD`);

    const promptMsg = `💰 *Selected Top-Up Amount:* \`$${amount.toFixed(2)} USD\`\n\n` +
      `📸 *Payment Slip Screenshot (ငွေလွှဲပြေစာ ပုံ ပို့ပေးပါ)*\n` +
      `ငွေဖြည့်သွင်းမှု အတည်ပြုရန်အတွက် ငွေလွှဲပြေစာ Screenshot (ဓာတ်ပုံ) ကို ပေးပို့ပေးပါ:\n` +
      `💡 _(ဓာတ်ပုံနှင့်အတူ Caption ဖြင့် KPay Ref သို့မဟုတ် Note ရေးထည့်နိုင်ပါသည်)_\n\n` +
      `⚠️ *ငွေလွှဲပြေစာ ဓာတ်ပုံမပါဘဲ ငွေဖြည့်သွင်းခွင့် တင်၍မရပါ။*`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ Cancel', 'cancel_topup')]
    ]);

    await safeEditMessageText(ctx, promptMsg, keyboard);
  });

  bot.action('topup_custom', async (ctx) => {
    ctx.session.step = 'INPUT_TOPUP_AMOUNT';
    await ctx.answerCbQuery();
    await safeEditMessageText(
      ctx,
      '✏️ ကျေးဇူးပြု၍ ထည့်သွင်းလိုသော USD ပမာဏကို စာရိုက်ထည့်ပေးပါ (ဥပမာ: `15`, `25.50`, `100`):\n\n_မပြုလုပ်လိုပါက /cancel ဟု ပို့နိုင်ပါသည်။_'
    );
  });

  bot.action('cancel_topup', async (ctx) => {
    ctx.session = {};
    await ctx.answerCbQuery('Cancelled');
    await safeEditMessageText(ctx, '❌ Top-up request cancelled.');
  });

  function isValidValue(val: any): boolean {
    if (val === null || val === undefined) return false;
    const s = String(val).trim();
    if (!s || s === '' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null' || s === '[object Object]') {
      return false;
    }
    return true;
  }

  function formatOrderTreeNode(o: any, orderNumber: number, showUserInfo: boolean = false): string {
    const isTopupNation = o.provider === 'topupnation' || o.extraInfo?.provider === 'topupnation';
    const providerBadge = isTopupNation ? '⚡ TopupNation API' : '🎮 LootBar API';
    const safeGame = escapeMd(o.gameName || 'Game');
    const safeSku = escapeMd(o.skuName || `Product #${o.skuId}`);
    const priceVal = `$${Number(o.price || 0).toFixed(3)}`;

    const stateMap: Record<number, { statusText: string; icon: string; message: string }> = {
      0: { statusText: 'PENDING', icon: '⏳', message: 'Order created, awaiting transaction' },
      1: { statusText: 'PROCESSING', icon: '🔄', message: isTopupNation ? 'TopupNation delivering top-up' : 'LootBar delivering top-up' },
      2: { statusText: 'COMPLETED', icon: '✅', message: 'Order completed successfully' },
      3: { statusText: 'FAILED', icon: '❌', message: 'Order failed on game server (Refunded)' },
      4: { statusText: 'SETTLING', icon: '⚡', message: 'Transaction in settlement stage' },
      5: { statusText: 'PARTIAL', icon: '⚠️', message: 'Order partially fulfilled' },
      6: { statusText: 'CANCELLED', icon: '🚫', message: 'Order was cancelled' }
    };

    const status = stateMap[o.state] || { statusText: 'PROCESSING', icon: '⏳', message: isTopupNation ? 'TopupNation processing' : 'LootBar processing' };

    const lines: string[] = [];
    lines.push(`*Order #${orderNumber}* ❲ *${providerBadge}* ❳`);

    if (o.telegramUsername || (showUserInfo && o.telegramChatId)) {
      const userDisplay = o.telegramUsername 
        ? `@${escapeMd(o.telegramUsername)}` 
        : (o.telegramFirstName ? escapeMd(o.telegramFirstName) : `User \`${o.telegramChatId}\``);
      lines.push(`├── 👤 User: *${userDisplay}* \`(${o.telegramChatId})\``);
    }

    const displayOrderId = o.providerOrderId || o.orderId || o.referenceId || 'Pending';
    lines.push(`├── 🆔 Order ID: \`${displayOrderId}\``);
    lines.push(`├── 🌐 Provider: *${providerBadge}*`);
    lines.push(`├── 🎮 Game: *${safeGame}*`);
    lines.push(`├── 📦 Package: *${safeSku}*`);

    // Parse player details cleanly - Strictly omit if undefined or missing
    let playerName = isValidValue(o.playerName) ? String(o.playerName).trim() : '';
    let playerId = '';
    let serverId = '';
    const otherDetails: { key: string; val: string }[] = [];

    if (o.extraInfo && typeof o.extraInfo === 'object') {
      for (const [key, val] of Object.entries(o.extraInfo)) {
        if (!isValidValue(val)) continue;
        if (key === 'paymentSource' || key === 'provider') continue;
        const lk = key.toLowerCase();
        if (!playerId && (lk === 'uid' || lk === 'userid' || lk === 'user_id' || lk === 'player_id' || lk === 'account_id' || lk === 'useraccount')) {
          playerId = String(val).trim();
        } else if (!serverId && (lk === 'zoneid' || lk === 'zone_id' || lk === 'server' || lk === 'server_id' || lk === 'serverid')) {
          serverId = String(val).trim();
        } else if (!playerName && (lk === 'player_name' || lk === 'role_name' || lk === 'nickname' || lk === 'playername' || lk === 'role')) {
          playerName = String(val).trim();
        } else {
          otherDetails.push({ key: key.toUpperCase(), val: String(val).trim() });
        }
      }
    }

    if (isValidValue(playerName)) {
      lines.push(`├── 👤 Player: \`${escapeCode(playerName)}\``);
    }
    if (isValidValue(playerId)) {
      lines.push(`├── 🎯 Player ID: \`${escapeCode(playerId)}\``);
    }
    if (isValidValue(serverId)) {
      lines.push(`├── 🌐 Server ID: \`${escapeCode(serverId)}\``);
    }
    for (const item of otherDetails) {
      if (isValidValue(item.val)) {
        lines.push(`├── ▫️ ${escapeMd(item.key)}: \`${escapeCode(item.val)}\``);
      }
    }

    lines.push(`├── ${status.icon} Status: *${status.statusText}*`);
    lines.push(`├── 💬 Message: _${escapeMd(status.message)}_`);
    lines.push(`├── 💰 Price: \`${priceVal}\``);
    lines.push(`└── 🕒 Time: \`${formatMyanmarDateTime(o.createdAt)}\``);

    return lines.join('\n');
  }

  async function renderOrderHistory(
    ctx: MyContext, 
    isEdit: boolean = false, 
    page: number = 1, 
    providerFilter: 'all' | 'lootbar' | 'topupnation' = 'all',
    scope?: 'all' | 'mine'
  ) {
    const pageSize = 3;
    const chatId = ctx.chat!.id;
    const currentAdminId = await getAdminChatId(adminChatId);
    const isOwner = String(chatId) === currentAdminId;

    // Determine actual scope: if owner and not explicitly set to 'mine', default to 'all' for owner
    const actualScope: 'all' | 'mine' = isOwner ? (scope || 'all') : 'mine';
    const isAllUsersView = isOwner && actualScope === 'all';

    // Build base user query condition
    const userQuery: any = isAllUsersView ? {} : { telegramChatId: chatId };

    // Build query based on provider filter
    const query: any = { ...userQuery };
    if (providerFilter === 'topupnation') {
      query.$or = [
        { provider: 'topupnation' },
        { 'extraInfo.provider': 'topupnation' }
      ];
    } else if (providerFilter === 'lootbar') {
      query.$and = [
        { provider: { $ne: 'topupnation' } },
        { 'extraInfo.provider': { $ne: 'topupnation' } }
      ];
    }

    // Counts for tabs
    const [totalAll, totalLootBar, totalTopupNation] = await Promise.all([
      Order.countDocuments(userQuery),
      Order.countDocuments({
        ...userQuery,
        provider: { $ne: 'topupnation' },
        'extraInfo.provider': { $ne: 'topupnation' }
      }),
      Order.countDocuments({
        ...userQuery,
        $or: [
          { provider: 'topupnation' },
          { 'extraInfo.provider': 'topupnation' }
        ]
      })
    ]);

    const totalOrders = providerFilter === 'topupnation' 
      ? totalTopupNation 
      : providerFilter === 'lootbar' 
        ? totalLootBar 
        : totalAll;

    const providerTitle = providerFilter === 'topupnation' 
      ? '⚡ TopupNation' 
      : providerFilter === 'lootbar' 
        ? '🎮 LootBar' 
        : '🌐 All Providers';

    const headerTitle = isAllUsersView 
      ? `👑 *All Users' Orders (Admin View)* — ${providerTitle}`
      : `⏳ *My Order History* — ${providerTitle}`;

    if (totalOrders === 0) {
      const emptyMsg = `${headerTitle}\n═════════════════════════\n\n📜 _အော်ဒါမှတ်တမ်း မရှိသေးပါ။_\n\nအခြား Category ကို ရွေးချယ်ကြည့်ရှုနိုင်ပါသည်:`;
      const buttons: any[] = [
        [
          Markup.button.callback(`🌐 All (${totalAll})`, `order_filter_all_${actualScope}_page_1`),
          Markup.button.callback(`🎮 LootBar (${totalLootBar})`, `order_filter_lootbar_${actualScope}_page_1`),
          Markup.button.callback(`⚡ TopupNation (${totalTopupNation})`, `order_filter_topupnation_${actualScope}_page_1`)
        ]
      ];

      if (isOwner) {
        buttons.push([
          isAllUsersView 
            ? Markup.button.callback('👤 Switch to My Orders Only', `order_filter_${providerFilter}_mine_page_1`)
            : Markup.button.callback('👑 Switch to All Users\' Orders', `order_filter_${providerFilter}_all_page_1`)
        ]);
      }

      const emptyKeyboard = Markup.inlineKeyboard(buttons);
      if (isEdit) {
        return await safeEditMessageText(ctx, emptyMsg, emptyKeyboard);
      }
      return await safeReply(ctx, emptyMsg, emptyKeyboard);
    }

    const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
    const currentPage = Math.min(Math.max(1, page), totalPages);

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip((currentPage - 1) * pageSize)
      .limit(pageSize);

    let msg = `${headerTitle}\n` +
      `📄 Page ${currentPage} of ${totalPages}\n` +
      `═════════════════════════\n\n`;

    const startIndex = (currentPage - 1) * pageSize;
    orders.forEach((o, i) => {
      const orderNumber = startIndex + i + 1;
      msg += formatOrderTreeNode(o, orderNumber, isAllUsersView) + '\n';
      if (i < orders.length - 1) {
        msg += `─────────────────────────\n\n`;
      }
    });

    const showingEnd = Math.min(startIndex + pageSize, totalOrders);
    msg += `═════════════════════════\n` +
      `📊 Showing ${startIndex + 1}-${showingEnd} of ${totalOrders} orders`;

    const buttonRows: any[] = [];

    // Filter Switcher Tabs Bar
    buttonRows.push([
      Markup.button.callback(`${providerFilter === 'all' ? '🔘' : '🌐'} All (${totalAll})`, `order_filter_all_${actualScope}_page_1`),
      Markup.button.callback(`${providerFilter === 'lootbar' ? '🔘' : '🎮'} LootBar (${totalLootBar})`, `order_filter_lootbar_${actualScope}_page_1`),
      Markup.button.callback(`${providerFilter === 'topupnation' ? '🔘' : '⚡'} TopupNation (${totalTopupNation})`, `order_filter_topupnation_${actualScope}_page_1`)
    ]);

    // For Owner: Scope switcher button
    if (isOwner) {
      buttonRows.push([
        isAllUsersView 
          ? Markup.button.callback('👤 Switch: My Orders Only', `order_filter_${providerFilter}_mine_page_1`)
          : Markup.button.callback('👑 Switch: All Users\' Orders', `order_filter_${providerFilter}_all_page_1`)
      ]);
    }

    const navRow: any[] = [];

    if (currentPage > 1) {
      navRow.push(Markup.button.callback('◀️ Prev', `order_filter_${providerFilter}_${actualScope}_page_${currentPage - 1}`));
    }
    navRow.push(Markup.button.callback(`📄 ${currentPage}/${totalPages}`, 'noop_page_indicator'));
    if (currentPage < totalPages) {
      navRow.push(Markup.button.callback('Next ▶️', `order_filter_${providerFilter}_${actualScope}_page_${currentPage + 1}`));
    }

    if (navRow.length > 0) {
      buttonRows.push(navRow);
    }

    buttonRows.push([
      Markup.button.callback('🔄 Refresh List', `order_filter_${providerFilter}_${actualScope}_page_${currentPage}`)
    ]);

    const keyboard = Markup.inlineKeyboard(buttonRows);

    if (isEdit) {
      return await safeEditMessageText(ctx, msg, keyboard);
    }
    return await safeReply(ctx, msg, keyboard);
  }

  // Handle provider and scope tab switching and pagination
  bot.action(/^order_filter_(all|lootbar|topupnation)_(all|mine)_page_(\d+)$/, async (ctx) => {
    const provider = ctx.match[1] as 'all' | 'lootbar' | 'topupnation';
    const scope = ctx.match[2] as 'all' | 'mine';
    const page = parseInt(ctx.match[3], 10) || 1;
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx, true, page, provider, scope);
  });

  bot.action(/^order_filter_(all|lootbar|topupnation)_page_(\d+)$/, async (ctx) => {
    const provider = ctx.match[1] as 'all' | 'lootbar' | 'topupnation';
    const page = parseInt(ctx.match[2], 10) || 1;
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx, true, page, provider);
  });

  bot.action(/^order_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10) || 1;
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx, true, page, 'all');
  });

  bot.action('view_orders_action', async (ctx) => {
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx);
  });

  bot.command(['allorders', 'adminorders', 'all_orders', 'admin_orders', 'ownerorders'], async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat.id) !== currentAdminId) {
      return ctx.reply('🚫 Unauthorized: Owner only command.');
    }
    return await renderOrderHistory(ctx, false, 1, 'all', 'all');
  });

  bot.action('noop_page_indicator', async (ctx) => {
    await ctx.answerCbQuery();
  });

  bot.hears(['📜 Order History', 'Order History', 'Orders', 'orders', '📜 Orders', 'Live Status', 'Check Status', 'Status'], async (ctx) => {
    return await renderOrderHistory(ctx, false, 1, 'all');
  });

  bot.command(['orders', 'history', 'orderhistory'], async (ctx) => {
    return await renderOrderHistory(ctx, false, 1, 'all');
  });

  bot.command(['status', 'track', 'checkstatus'], async (ctx) => {
    const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '').trim();
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
      return ctx.reply(
        `🔍 *Check Live Order Status*\n\n` +
        `အော်ဒါ၏ လက်ရှိ Live Status ကို API မှ တိုက်ရိုက် စစ်ဆေးရန်အတွက် အောက်ပါအတိုင်း ရိုက်ပို့နိုင်ပါသည်:\n\n` +
        `📌 *Format:* \`/status <Order_ID သို့မဟုတ် Ref_ID>\`\n` +
        `💡 *ဥပမာ:* \`/status LB-12345678\`\n\n` +
        `သို့မဟုတ် အောက်ပါခလုတ်ကိုနှိပ်၍ *Order History* မှတစ်ဆင့် အော်ဒါများကို တိုက်ရိုက်စစ်ဆေးနိုင်ပါသည်:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('📜 View Order History', 'view_orders_action')]])
        }
      );
    }
    const orderQuery = parts[1].trim();
    return await handleTrackOrderQuery(ctx, orderQuery, false);
  });

  bot.action('refresh_order_history', async (ctx) => {
    await ctx.answerCbQuery('Refreshing order history...');
    return await renderOrderHistory(ctx, true, 1);
  });

  bot.hears(['🎮 LootBar Games', 'LootBar Games', 'Lootbar Games', 'LootBar', 'lootbar'], async (ctx) => {
    return await renderLootBarGameList(ctx);
  });

  bot.hears(['🌐 TopupNation Games', 'TopupNation Games', 'TopUpNation Games', 'TopupNation', 'tpn'], async (ctx) => {
    return await renderTopupNationGameList(ctx);
  });

  bot.hears(['🎮 Game List', 'Game List', 'Games', 'games', '🎮 Games'], async (ctx) => {
    return await renderAllGamesList(ctx);
  });

  bot.command(['lootbar', 'lb'], async (ctx) => {
    return await renderLootBarGameList(ctx);
  });

  bot.command(['tpn', 'topupnation'], async (ctx) => {
    return await renderTopupNationGameList(ctx);
  });

  bot.command(['games', 'gamelist'], async (ctx) => {
    return await renderAllGamesList(ctx);
  });

  bot.action(/^game_(.+)$/, async (ctx) => {
    const gameId = ctx.match[1];
    ctx.session.gameId = gameId;
    
    // Find game name
    const savedGame = await SavedGame.findOne({ gameId });
    let gameName = savedGame?.name;
    
    try {
      const response = await lootbar.getSkus(gameId);
      const skus = response?.data?.items || [];
      
      if (!skus || skus.length === 0) {
        return ctx.editMessageText('⚠️ No packages/SKUs available for this game at the moment.', Markup.inlineKeyboard([[
          Markup.button.callback('🔙 Back to Games', 'back_to_games')
        ]]));
      }

      if (!gameName && skus[0]?.game_name) {
        gameName = skus[0].game_name;
      }
      ctx.session.gameName = gameName || `Game ${gameId}`;
      ctx.session.skus = skus;

      const buttons = skus.map((sku: any) => {
        const name = sku.sku_name || 'Unknown Item';
        const price = sku.reseller_price ? ` ($${sku.reseller_price})` : '';
        return Markup.button.callback(`${name}${price}`, `sku_${sku.sku_id}`);
      });

      // 1 button per row for SKUs to allow long names and prices
      const keyboard = buttons.map(btn => [btn]);
      keyboard.push([Markup.button.callback('🔙 Back to Games', 'back_to_games')]);

      ctx.session.step = 'SELECT_SKU';
      return ctx.editMessageText(`🎮 *${ctx.session.gameName}*\n\n🛍 Please select a product package:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboard)
      });
    } catch (error: any) {
      console.error('Failed to fetch SKUs:', error);
      return ctx.editMessageText(`An error occurred while fetching SKUs: ${error.message}`, Markup.inlineKeyboard([[
        Markup.button.callback('🔙 Back to Games', 'back_to_games')
      ]]));
    }
  });

  bot.action('back_to_games', async (ctx) => {
    ctx.session.step = 'SELECT_GAME';
    const savedGames = await SavedGame.find({}).sort({ savedAt: -1 });
    let games: { game_id: string; game_name: string }[] = [];
    if (savedGames && savedGames.length > 0) {
      games = savedGames.map((g: any) => ({ game_id: String(g.gameId), game_name: g.name }));
    } else {
      const response = await lootbar.getGames();
      games = response?.data?.items || [];
    }
    const buttons = games.map((game: any) => [
      Markup.button.callback(game.game_name || 'Game', `game_${game.game_id}`)
    ]);
    return ctx.editMessageText('🎮 Please select a game:', Markup.inlineKeyboard(buttons));
  });

  bot.action(/^sku_(.+)$/, async (ctx) => {
    const skuId = ctx.match[1];
    ctx.session.skuId = skuId;
    
    const skus = ctx.session.skus || [];
    const selectedSku = skus.find(s => String(s.sku_id) === skuId);
    
    if (!selectedSku) {
      return ctx.editMessageText('SKU not found. Please try again.', Markup.inlineKeyboard([[
        Markup.button.callback('🔙 Back to Games', 'back_to_games')
      ]]));
    }

    ctx.session.skuName = selectedSku.sku_name || 'Selected Item';
    ctx.session.skuPrice = parseFloat(selectedSku.reseller_price || selectedSku.price || '0');

    // Default to 'uid' if not specified
    const requiredFields = (selectedSku.extra_info || []).filter((f: any) => f.required);
    if (requiredFields.length === 0) {
      requiredFields.push({ name: 'uid', title: 'Player ID / UID', type: 'input' });
    }
    
    ctx.session.requiredFields = requiredFields;
    ctx.session.extraInfo = {};
    ctx.session.currentFieldIndex = 0;
    ctx.session.step = 'INPUT_EXTRA_INFO';

    return await askNextRequiredField(ctx);
  });

  bot.command('cancel', async (ctx) => {
    ctx.session = {};
    return ctx.reply('❌ Action cancelled. Main Menu:', mainMenu);
  });

  bot.action('cancel_order', async (ctx) => {
    ctx.session = {};
    await ctx.answerCbQuery('Order cancelled');
    return ctx.reply('❌ Order cancelled. Main Menu:', mainMenu);
  });

  async function askNextRequiredField(ctx: MyContext) {
    const requiredFields = ctx.session.requiredFields || [];
    const currentIndex = ctx.session.currentFieldIndex || 0;
    const nextField = requiredFields[currentIndex];

    const skuName = ctx.session.skuName || 'Selected Item';
    const price = ctx.session.skuPrice !== undefined ? ctx.session.skuPrice.toFixed(2) : '0.00';
    const gameName = ctx.session.gameName || 'Game';

    const infoHeader = `🎮 *Game:* ${gameName}\n🛍 *Product:* \`${skuName}\`\n💰 *Price:* \`$${price} USD\`\n\n`;
    const promptText = `${infoHeader}✏️ Please enter your *${nextField.title || nextField.name}*:`;

    const cancelBtn = Markup.button.callback('❌ Cancel Order', 'cancel_order');

    if (nextField.type === 'select' && Array.isArray(nextField.options)) {
      const buttons = nextField.options.map((opt: any) => {
        const val = typeof opt === 'object' ? opt.value : opt;
        const label = typeof opt === 'object' ? opt.title || opt.label || val : val;
        return Markup.button.callback(String(label), `opt_${nextField.name}_${val}`.substring(0, 64));
      });
      const keyboard = [];
      for (let i = 0; i < buttons.length; i += 2) {
        keyboard.push(buttons.slice(i, i + 2));
      }
      keyboard.push([cancelBtn]);
      return ctx.reply(promptText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(keyboard) });
    } else {
      return ctx.reply(promptText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[cancelBtn]]) });
    }
  }

  // Handle select options
  bot.action(/^opt_(.+?)_(.+)$/, async (ctx) => {
    if (ctx.session.step !== 'INPUT_EXTRA_INFO') return;
    const fieldName = ctx.match[1];
    const value = ctx.match[2];

    const requiredFields = ctx.session.requiredFields || [];
    const currentIndex = ctx.session.currentFieldIndex || 0;
    const currentField = requiredFields[currentIndex];

    if (currentField?.name !== fieldName) {
      return ctx.answerCbQuery('Unexpected option selection.');
    }

    if (!ctx.session.extraInfo) ctx.session.extraInfo = {};
    ctx.session.extraInfo[currentField.name] = value;

    await ctx.answerCbQuery();
    await ctx.editMessageText(`✅ Selected ${currentField.title || currentField.name}: *${value}*`, { parse_mode: 'Markdown' });

    const nextIndex = currentIndex + 1;
    if (nextIndex < requiredFields.length) {
      ctx.session.currentFieldIndex = nextIndex;
      await askNextRequiredField(ctx);
    } else {
      await showOrderConfirmation(ctx);
    }
  });

  // Photo upload handler for Payment Proof / Slip
  bot.on('photo', async (ctx, next) => {
    if (ctx.session?.step === 'INPUT_TOPUP_PHOTO') {
      const amount = ctx.session.topupAmount || 0;
      if (amount <= 0) {
        ctx.session = {};
        return safeReply(ctx, '❌ Top-up session expired. Please start again from menu.', mainMenu);
      }

      const photos = ctx.message.photo;
      const largestPhoto = photos[photos.length - 1];
      const photoFileId = largestPhoto.file_id;
      const note = ctx.message.caption || '';

      return await submitTopupRequest(ctx, amount, note, photoFileId);
    }

    return next();
  });

  bot.on('text', async (ctx, next) => {
    const userInput = ctx.message.text.trim();

    if (userInput.toLowerCase() === 'cancel' || userInput === '/cancel') {
      ctx.session = {};
      return safeReply(ctx, '❌ Cancelled. Main Menu:', mainMenu);
    }

    // Top-up flow: Custom amount input
    if (ctx.session?.step === 'INPUT_TOPUP_AMOUNT') {
      const sanitized = userInput.replace(/[$USD,\s]/gi, '');
      const parsedAmount = parseFloat(sanitized);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return safeReply(ctx, '⚠️ ကျေးဇူးပြု၍ မှန်ကန်သော USD ပမာဏကို ဂဏန်းဖြင့်သာ ရိုက်ထည့်ပေးပါ (ဥပမာ: `10`, `25.50`, `100`):\n\n_သို့မဟုတ် /cancel ဖြင့် ဖျက်သိမ်းနိုင်ပါသည်။_');
      }

      ctx.session.topupAmount = parsedAmount;
      ctx.session.step = 'INPUT_TOPUP_PHOTO';

      const promptMsg = `💰 *Selected Top-Up Amount:* \`$${parsedAmount.toFixed(2)} USD\`\n\n` +
        `📸 *Payment Slip Screenshot (ငွေလွှဲပြေစာ ပုံ ပို့ပေးပါ)*\n` +
        `ငွေဖြည့်သွင်းမှု အတည်ပြုရန်အတွက် ငွေလွှဲပြေစာ Screenshot (ဓာတ်ပုံ) ကို ပေးပို့ပေးပါ:\n` +
        `💡 _(ဓာတ်ပုံနှင့်အတူ Caption ဖြင့် KPay Ref သို့မဟုတ် Note ရေးထည့်နိုင်ပါသည်)_\n\n` +
        `⚠️ *ငွေလွှဲပြေစာ ဓာတ်ပုံမပါဘဲ ငွေဖြည့်သွင်းခွင့် တင်၍မရပါ။*`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'cancel_topup')]
      ]);

      return safeReply(ctx, promptMsg, keyboard);
    }

    // Top-up flow: User sent text when photo is required
    if (ctx.session?.step === 'INPUT_TOPUP_PHOTO') {
      const amount = ctx.session.topupAmount || 0;
      return safeReply(
        ctx,
        `⚠️ *ငွေလွှဲပြေစာ Screenshot (ဓာတ်ပုံ) ပေးပို့ရန် လိုအပ်ပါသည်*\n\n` +
        `ရွေးချယ်ထားသော ပမာဏ: \`$${amount.toFixed(2)} USD\`\n` +
        `ငွေဖြည့်သွင်းမှု အတည်ပြုနိုင်ရန်အတွက် ငွေလွှဲထားသော ပြေစာပုံ Screenshot ကို Photo အနေဖြင့် ပေးပို့ပေးပါ (Photo Required).\n\n` +
        `_မပြုလုပ်လိုပါက /cancel ဟု ပို့နိုင်ပါသည်။_`
      );
    }

    // Order flow: Required extra info input
    if (ctx.session?.step === 'INPUT_EXTRA_INFO') {
      const requiredFields = ctx.session.requiredFields || [];
      const currentIndex = ctx.session.currentFieldIndex || 0;
      
      if (requiredFields.length === 0) return next();

      const currentField = requiredFields[currentIndex];
      
      // Ignore text if we are expecting a select
      if (currentField.type === 'select') {
        return ctx.reply(`Please use the buttons above to select your ${currentField.title || currentField.name}.`);
      }

      if (!ctx.session.extraInfo) ctx.session.extraInfo = {};
      ctx.session.extraInfo[currentField.name] = userInput;
      
      const nextIndex = currentIndex + 1;
      
      if (nextIndex < requiredFields.length) {
        ctx.session.currentFieldIndex = nextIndex;
        await askNextRequiredField(ctx);
      } else {
        await showOrderConfirmation(ctx);
      }
      return;
    }

    return next();
  });

  async function showOrderConfirmation(ctx: MyContext) {
    ctx.session.step = 'CONFIRM_ORDER';
    const userDoc = await User.findOne({ telegramChatId: ctx.chat!.id });
    const isApiLinked = !!(userDoc?.useDirectApiBalance || userDoc?.balanceMode === 'api');
    const userBalance = userDoc?.balance || 0;
    
    const gameId = ctx.session.gameId;
    const gameName = ctx.session.gameName || 'Game';
    const skuName = ctx.session.skuName || 'Product';
    const price = ctx.session.skuPrice || 0;
    let playerName = ctx.session.playerName;
    const extraInfo = ctx.session.extraInfo || {};

    // Optional: Try to resolve player name in background if available
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
    }

    let playerId = '';
    let serverId = '';
    const otherDetails: { key: string; val: string }[] = [];

    for (const [key, val] of Object.entries(extraInfo)) {
      if (!isValidValue(val)) continue;
      if (key === 'paymentSource' || key === 'provider') continue;
      const lk = key.toLowerCase();
      if (!playerId && (lk === 'uid' || lk === 'userid' || lk === 'user_id' || lk === 'player_id' || lk === 'account_id' || lk === 'useraccount')) {
        playerId = String(val).trim();
      } else if (!serverId && (lk === 'zoneid' || lk === 'zone_id' || lk === 'server' || lk === 'server_id' || lk === 'serverid')) {
        serverId = String(val).trim();
      } else if (!playerName && (lk === 'player_name' || lk === 'role_name' || lk === 'nickname' || lk === 'playername' || lk === 'role')) {
        playerName = String(val).trim();
      } else {
        otherDetails.push({ key: key.toUpperCase(), val: String(val).trim() });
      }
    }

    const balanceAfter = userBalance - price;

    if (!isApiLinked && userBalance < price) {
      const needed = (price - userBalance).toFixed(2);
      const failMsg = `⚠️ *Insufficient Balance!*\n═════════════════════════\n` +
        `├── 🎮 Game: *${escapeMd(gameName)}*\n` +
        `├── 📦 Package: *${escapeMd(skuName)}*\n` +
        `├── 💰 Required: \`$${price.toFixed(3)}\`\n` +
        `└── 💳 Your Balance: \`$${userBalance.toFixed(3)}\`\n` +
        `═════════════════════════\n` +
        `_You need $${needed} USD more to place this order._`;

      return ctx.reply(failMsg, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💰 Top Up Balance', 'topup_flow_start')],
          [Markup.button.callback('❌ Cancel', 'cancel_order')]
        ])
      });
    }

    const lines: string[] = [];
    lines.push(`🛒 *Confirm Top-Up Order*`);
    lines.push(`═════════════════════════`);
    lines.push(`├── 🎮 Game: *${escapeMd(gameName)}*`);
    lines.push(`├── 📦 Package: *${escapeMd(skuName)}*`);
    if (isValidValue(playerName)) {
      lines.push(`├── 👤 Player: \`${escapeCode(playerName)}\``);
    }
    if (isValidValue(playerId)) {
      lines.push(`├── 🎯 Player ID: \`${escapeCode(playerId)}\``);
    }
    if (isValidValue(serverId)) {
      lines.push(`├── 🌐 Server ID: \`${escapeCode(serverId)}\``);
    }
    for (const item of otherDetails) {
      if (isValidValue(item.val)) {
        lines.push(`├── ▫️ ${escapeMd(item.key)}: \`${escapeCode(item.val)}\``);
      }
    }
    lines.push(`├── 💰 Price: \`$${price.toFixed(3)}\``);
    if (isApiLinked) {
      lines.push(`└── 💳 Payment: \`⚡ Direct API Balance Linked\``);
    } else {
      lines.push(`├── 💳 Payment: \`Wallet Balance ($${userBalance.toFixed(2)})\``);
      lines.push(`└── 💵 Remaining After: \`$${balanceAfter.toFixed(2)}\``);
    }
    lines.push(`═════════════════════════`);

    return ctx.reply(lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Confirm & Pay ($${price.toFixed(2)})`, 'confirm_place_order')],
        [Markup.button.callback('❌ Cancel Order', 'cancel_order')]
      ])
    });
  }

  bot.action('confirm_place_order', async (ctx) => {
    await ctx.answerCbQuery();
    await finalizeOrder(ctx);
  });

  async function finalizeOrder(ctx: MyContext) {
    const isTopupNation = ctx.session.provider === 'topupnation';
    ctx.session.step = 'DONE';
    await ctx.reply(`⏳ Processing your top-up order with ${isTopupNation ? 'TopupNation' : 'LootBar'} API, please wait...`);
    
    const referenceId = uuidv4().replace(/-/g, '').substring(0, 32);
    const gameId = ctx.session.gameId!;
    const skuId = ctx.session.skuId!;
    const gameName = ctx.session.gameName || 'Game';
    const skuName = ctx.session.skuName || 'Product';
    let playerName = ctx.session.playerName || undefined;
    const extraInfo = ctx.session.extraInfo || {};
    
    const userDoc = await User.findOne({ telegramChatId: ctx.chat!.id });
    if (!userDoc) {
      return ctx.reply('❌ User account not found.');
    }

    const currentTelegramUsername = ctx.from?.username || (ctx.chat as any)?.username || userDoc.username || undefined;
    const currentTelegramFirstName = ctx.from?.first_name || (ctx.chat as any)?.first_name || userDoc.firstName || undefined;
    const currentTelegramLastName = ctx.from?.last_name || (ctx.chat as any)?.last_name || undefined;
    
    const isApiLinked = !!(userDoc.useDirectApiBalance || userDoc.balanceMode === 'api');
    let orderCost = ctx.session.skuPrice || 1;

    if (isTopupNation && topupNation) {
      // Execute through TopupNation Service
      const result = await topupNation.placeOrder({
        telegramChatId: ctx.chat!.id,
        telegramUsername: currentTelegramUsername,
        telegramFirstName: currentTelegramFirstName,
        telegramLastName: currentTelegramLastName,
        productId: gameId,
        sku: skuId,
        fields: extraInfo,
        quantity: 1
      });

      if (!result.success || !result.order) {
        return ctx.reply(`❌ Order failed: ${result.error || 'TopupNation rejected order'}`, mainMenu);
      }

      const order = result.order;
      const orderId = order.providerOrderId || order.orderId;
      const statusKeyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🔄 Check Live Status', `track_order_${order.referenceId}`),
          Markup.button.callback('📜 Order History', 'view_orders_action')
        ]
      ]);

      const safeGame = escapeMd(gameName);
      const safeSku = escapeMd(skuName);

      const lines: string[] = [];
      lines.push(`✅ *Top-Up Order Submitted!*`);
      lines.push(`═════════════════════════`);
      lines.push(`├── 🆔 Order ID: \`${orderId}\``);
      lines.push(`├── 🌐 Provider: *TopupNation*`);
      lines.push(`├── 🎮 Game: *${safeGame}*`);
      lines.push(`├── 📦 Package: *${safeSku}*`);
      if (order.playerName) {
        lines.push(`├── 👤 Player/Account: \`${escapeCode(order.playerName)}\``);
      }
      lines.push(`├── 🔄 Status: *PROCESSING*`);
      lines.push(`├── 💬 Message: _Order accepted by TopupNation API_`);
      lines.push(`├── 💰 Price: \`$${orderCost.toFixed(3)}\``);
      lines.push(`├── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\``);
      if (!isApiLinked) {
        const updatedUser = await User.findOne({ telegramChatId: ctx.chat!.id });
        lines.push(`└── 💳 Remaining Balance: \`$${(updatedUser?.balance || 0).toFixed(2)}\``);
      } else {
        lines.push(`└── 💳 Payment: \`⚡ Direct API Balance Linked\``);
      }
      lines.push(`═════════════════════════`);

      await safeReply(ctx, lines.join('\n'), statusKeyboard);

      // Notify Owner ONLY
      const currentAdminIdForNotify = await getAdminChatId(adminChatId);
      const fromUser = ctx.from?.username 
        ? `@${ctx.from.username}` 
        : (ctx.chat as any)?.username 
          ? `@${(ctx.chat as any).username}` 
          : ctx.from?.first_name || 'User';

      const safeFromUser = escapeMd(fromUser);
      const adminOrderNotificationMsg = `🔔 *New Top-Up Order (TopupNation)!*\n` +
        `═════════════════════════\n` +
        `├── 👤 User: \`${ctx.chat!.id}\` (${safeFromUser})\n` +
        `├── 🌐 Provider: \`TopupNation\`\n` +
        `├── 🎮 Game: *${safeGame}*\n` +
        `├── 📦 Package: *${safeSku}*\n` +
        `├── 💰 Price: \`$${orderCost.toFixed(2)} USD\`\n` +
        (order.playerName ? `├── 🎯 Player/Account: \`${escapeCode(order.playerName)}\`\n` : '') +
        `├── 💳 Payment: \`${isApiLinked ? 'Direct API Linked' : 'Wallet Balance'}\`\n` +
        `├── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\`\n` +
        `└── 🆔 Order ID: \`${orderId}\`\n` +
        `═════════════════════════`;

      if (currentAdminIdForNotify) {
        await safeSendMessage(bot.telegram, currentAdminIdForNotify, adminOrderNotificationMsg);
      }
      return;
    }

    if (!isApiLinked) {
      if (userDoc.balance < orderCost) {
        return ctx.reply(`❌ Insufficient balance. Cost is $${orderCost.toFixed(2)}, but your balance is $${userDoc.balance.toFixed(2)}.`, mainMenu);
      }

      // Atomic Balance Deduction for standard wallet users
      userDoc.balance = Math.max(0, userDoc.balance - orderCost);
      await userDoc.save();
    }

    try {
      const orderResponse = await lootbar.createOrder(referenceId, gameId, skuId, 1, extraInfo);
      
      if (orderResponse?.status === 'ok' && orderResponse?.data?.order_id) {
        const orderId = orderResponse.data.order_id;
        
        try {
          await Order.create({
            referenceId,
            orderId,
            telegramChatId: ctx.chat!.id,
            telegramUsername: currentTelegramUsername,
            telegramFirstName: currentTelegramFirstName,
            telegramLastName: currentTelegramLastName,
            gameId,
            gameName,
            skuId,
            skuName,
            playerName,
            price: orderCost,
            extraInfo: {
              ...extraInfo,
              paymentSource: isApiLinked ? 'api_balance' : 'wallet_balance'
            },
            state: 1, // 1 = In transaction
          });
        } catch (dbErr) {
          console.error('Failed to save order to MongoDB:', dbErr);
        }

        const statusKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Check Live Status', `track_order_${referenceId}`),
            Markup.button.callback('📜 Order History', 'view_orders_action')
          ]
        ]);

        let playerId = '';
        let serverId = '';
        const otherDetails: { key: string; val: string }[] = [];

        if (extraInfo && typeof extraInfo === 'object') {
          for (const [k, v] of Object.entries(extraInfo)) {
            if (k === 'paymentSource') continue;
            const lk = k.toLowerCase();
            if (!playerId && (lk === 'uid' || lk === 'userid' || lk === 'user_id' || lk === 'player_id' || lk === 'account_id')) {
              playerId = String(v);
            } else if (!serverId && (lk === 'zoneid' || lk === 'zone_id' || lk === 'server' || lk === 'server_id' || lk === 'serverid')) {
              serverId = String(v);
            } else if (!playerName && (lk === 'player_name' || lk === 'role_name' || lk === 'nickname' || lk === 'playername')) {
              playerName = String(v);
            } else {
              otherDetails.push({ key: k.toUpperCase(), val: String(v) });
            }
          }
        }

        const safeGame = escapeMd(gameName);
        const safeSku = escapeMd(skuName);

        const lines: string[] = [];
        lines.push(`✅ *Top-Up Order Submitted!*`);
        lines.push(`═════════════════════════`);
        lines.push(`├── 🆔 Order ID: \`${orderId}\``);
        lines.push(`├── 🎮 Game: *${safeGame}*`);
        lines.push(`├── 📦 Package: *${safeSku}*`);
        if (playerName) {
          lines.push(`├── 👤 Player: \`${escapeCode(playerName)}\``);
        }
        if (playerId) {
          lines.push(`├── 🎯 Player ID: \`${escapeCode(playerId)}\``);
        }
        if (serverId) {
          lines.push(`├── 🌐 Server ID: \`${escapeCode(serverId)}\``);
        }
        for (const item of otherDetails) {
          lines.push(`├── ▫️ ${escapeMd(item.key)}: \`${escapeCode(item.val)}\``);
        }
        lines.push(`├── 🔄 Status: *PROCESSING*`);
        lines.push(`├── 💬 Message: _Order accepted by LootBar API_`);
        lines.push(`├── 💰 Price: \`$${orderCost.toFixed(3)}\``);
        lines.push(`├── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\``);
        if (!isApiLinked) {
          lines.push(`└── 💳 Remaining Balance: \`$${userDoc.balance.toFixed(2)}\``);
        } else {
          lines.push(`└── 💳 Payment: \`⚡ Direct API Balance Linked\``);
        }
        lines.push(`═════════════════════════`);

        const successMsg = lines.join('\n');

        await safeReply(ctx, successMsg, statusKeyboard);
        
        // Notify Owner ONLY (No broadcast to other users)
        const currentAdminIdForNotify = await getAdminChatId(adminChatId);
        const fromUser = ctx.from?.username 
          ? `@${ctx.from.username}` 
          : (ctx.chat as any)?.username 
            ? `@${(ctx.chat as any).username}` 
            : ctx.from?.first_name 
              ? ctx.from.first_name 
              : 'User';

        const safeFromUser = escapeMd(fromUser);

        const adminOrderNotificationMsg = `🔔 *New Top-Up Order Received!*\n` +
          `═════════════════════════\n` +
          `├── 👤 User: \`${ctx.chat!.id}\` (${safeFromUser})\n` +
          `├── 🎮 Game: *${safeGame}*\n` +
          `├── 📦 Package: *${safeSku}*\n` +
          `├── 💰 Price: \`$${orderCost.toFixed(2)} USD\`\n` +
          (playerName ? `├── 🎯 Player: \`${escapeCode(playerName)}\`\n` : '') +
          (playerId ? `├── 🎯 Player ID: \`${escapeCode(playerId)}\`\n` : '') +
          `├── 💳 Payment: \`${isApiLinked ? 'Direct API Linked' : 'Wallet Balance'}\`\n` +
          `├── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\`\n` +
          `└── 🆔 Order ID: \`${orderId}\`\n` +
          `═════════════════════════`;
        
        if (currentAdminIdForNotify) {
          await safeSendMessage(bot.telegram, currentAdminIdForNotify, adminOrderNotificationMsg);
        }

        // Background poller to check if order completes
        setTimeout(async () => {
          try {
            const queryRes = await lootbar.queryOrder(referenceId);
            if (queryRes?.data?.state === 2) {
              await Order.findOneAndUpdate({ referenceId }, { state: 2 });
              await safeSendMessage(
                bot.telegram, 
                ctx.chat!.id, 
                `🎉 *Top-Up Completed!*\n═════════════════════════\n` +
                `├── 🆔 Order ID: \`${orderId}\`\n` +
                `├── 🎮 Game: *${safeGame}*\n` +
                `├── 📦 Package: *${safeSku}*\n` +
                (playerName ? `├── 👤 Player: \`${escapeCode(playerName)}\`\n` : '') +
                `├── ✅ Status: *COMPLETED*\n` +
                `└── 💬 Message: _Fulfilled successfully on game server_\n` +
                `═════════════════════════`
              );
            } else if (queryRes?.data?.state === 3) {
              // Order failed, refund balance
              await Order.findOneAndUpdate({ referenceId }, { state: 3 });
              if (!isApiLinked) {
                const userToRefund = await User.findOne({ telegramChatId: ctx.chat!.id });
                if (userToRefund) {
                  userToRefund.balance += orderCost;
                  await userToRefund.save();
                }
              }
              await safeSendMessage(
                bot.telegram, 
                ctx.chat!.id, 
                `❌ *Order Failed*\n═════════════════════════\n` +
                `├── 🆔 Order ID: \`${orderId || referenceId}\`\n` +
                `├── 🎮 Game: *${safeGame}*\n` +
                `├── ❌ Status: *FAILED*\n` +
                `└── 💬 Message: _Could not be fulfilled on game server_${!isApiLinked ? ` (Refunded $${orderCost.toFixed(2)} USD)` : ''}\n` +
                `═════════════════════════`
              );
            }
          } catch (pollErr) {
            console.error('Polling order status error:', pollErr);
          }
        }, 12000);
      
      } else {
        // Refund balance if order failed
        if (!isApiLinked) {
          userDoc.balance += orderCost;
          await userDoc.save();
        }
        const msg = orderResponse?.msg || orderResponse?.message || 'LootBar rejected the transaction';
        await safeReply(ctx, `❌ *Failed to Place Order*\n\nReason: \`${escapeCode(msg)}\`${!isApiLinked ? `\n\nYour balance of $${orderCost.toFixed(2)} has been refunded to your wallet.` : ''}`, mainMenu);
      }
    
    } catch (error: any) {
      // Refund balance on exception
      if (!isApiLinked) {
        userDoc.balance += orderCost;
        await userDoc.save();
      }
      console.error('Order placement failed:', error);

      await safeReply(ctx, `❌ *Order Error*\n\nReason: \`${escapeCode(error.message || 'Server error')}\`${!isApiLinked ? `\n\nYour balance of $${orderCost.toFixed(2)} has been refunded to your wallet.` : ''}`, mainMenu);
    }
  }

  // Live multi-provider order status tracking logic
  async function handleTrackOrderQuery(ctx: any, queryId: string, isCallback: boolean = false) {
    const cleanId = (queryId || '').trim();
    if (!cleanId) {
      if (isCallback) {
        try { await ctx.answerCbQuery('Invalid order identifier'); } catch {}
      }
      return ctx.reply('⚠️ Please provide a valid Order ID or Reference ID.');
    }

    try {
      // 1. Try finding in MongoDB by exact match on referenceId, orderId, providerOrderId, or providerReceiptNumber
      let order = await Order.findOne({
        $or: [
          { referenceId: cleanId },
          { orderId: cleanId },
          { providerOrderId: cleanId },
          { providerReceiptNumber: cleanId }
        ]
      });

      // 1.1 If not found, try case-insensitive regex search
      if (!order) {
        order = await Order.findOne({
          $or: [
            { referenceId: { $regex: new RegExp(`^${cleanId}$`, 'i') } },
            { orderId: { $regex: new RegExp(`^${cleanId}$`, 'i') } },
            { providerOrderId: { $regex: new RegExp(`^${cleanId}$`, 'i') } }
          ]
        });
      }

      // Determine provider
      let isTopupNationOrder = order?.provider === 'topupnation' || order?.extraInfo?.provider === 'topupnation';
      if (!order && topupNation) {
        if (cleanId.startsWith('TPN-') || cleanId.startsWith('cmt') || cleanId.length > 20) {
          isTopupNationOrder = true;
        }
      }

      let state = order?.state ?? 1;
      let orderId = order?.providerOrderId || order?.orderId || cleanId;
      let syncNote = '';

      if (isTopupNationOrder && topupNation) {
        if (isCallback) {
          try { await ctx.answerCbQuery('📡 Querying live TopupNation API status...'); } catch {}
        }
        try {
          const tpnOrderId = order?.providerOrderId || order?.orderId || cleanId;
          const queryRes = await topupNation.getClient().queryOrder(tpnOrderId);
          if (queryRes && queryRes.status) {
            const statusUpper = String(queryRes.status).toUpperCase();
            if (statusUpper === 'SUCCESS' || statusUpper === 'COMPLETED') {
              state = 2;
              syncNote = 'Fulfilled successfully via TopupNation';
            } else if (statusUpper === 'FAILED' || statusUpper === 'REFUNDED' || statusUpper === 'CANCELLED') {
              state = 3;
              syncNote = queryRes.errorMessage || 'Failed on game server (Refunded)';
              const isApiLinked = order?.extraInfo?.paymentSource === 'api_balance';
              if (!isApiLinked && order && order.price > 0 && order.state !== 3) {
                const userDoc = await User.findOne({ telegramChatId: order.telegramChatId });
                if (userDoc) {
                  userDoc.balance += order.price;
                  await userDoc.save();
                }
              }
            } else if (statusUpper === 'PROCESSING') {
              state = 1;
              syncNote = 'TopupNation is currently processing the order';
            } else if (statusUpper === 'PENDING') {
              state = 0;
              syncNote = 'Order received, pending API queue';
            }

            if (order) {
              order.state = state;
              order.statusText = statusUpper;
              if (queryRes.receiptNumber) order.providerReceiptNumber = queryRes.receiptNumber;
              await order.save();
            }
          }
        } catch (tpnErr: any) {
          console.error('[Track Order] TopupNation query error:', tpnErr?.message || tpnErr);
          syncNote = order ? `Processing (${order.statusText || 'In Progress'})` : 'Processing via TopupNation API';
        }
      } else {
        // LootBar Order Query
        if (isCallback) {
          try { await ctx.answerCbQuery('📡 Querying live LootBar API status...'); } catch {}
        }
        try {
          const refToQuery = order?.referenceId || cleanId;
          const queryRes = await lootbar.queryOrder(refToQuery);
          if (queryRes && queryRes.status === 'ok' && queryRes.data) {
            state = queryRes.data.state !== undefined ? queryRes.data.state : state;
            orderId = queryRes.data.order_id || orderId;

            if (state === 3) {
              const isApiLinked = order?.extraInfo?.paymentSource === 'api_balance';
              if (!isApiLinked && order && order.price > 0 && order.state !== 3) {
                const userDoc = await User.findOne({ telegramChatId: order.telegramChatId });
                if (userDoc) {
                  userDoc.balance += order.price;
                  await userDoc.save();
                }
              }
            }

            if (order) {
              order.state = state;
              if (orderId) order.orderId = orderId;
              await order.save();
            }
          }
        } catch (lbErr: any) {
          console.error('[Track Order] LootBar query error:', lbErr?.message || lbErr);
          // If Lootbar query fails, try TopupNation fallback if not yet checked
          if (topupNation && !isTopupNationOrder) {
            try {
              const tpnOrderId = order?.providerOrderId || order?.orderId || cleanId;
              const queryRes = await topupNation.getClient().queryOrder(tpnOrderId);
              if (queryRes && queryRes.status) {
                isTopupNationOrder = true;
                const statusUpper = String(queryRes.status).toUpperCase();
                if (statusUpper === 'SUCCESS' || statusUpper === 'COMPLETED') {
                  state = 2;
                  syncNote = 'Fulfilled successfully via TopupNation';
                } else if (statusUpper === 'FAILED' || statusUpper === 'REFUNDED') {
                  state = 3;
                  syncNote = queryRes.errorMessage || 'Failed on game server (Refunded)';
                } else if (statusUpper === 'PROCESSING') {
                  state = 1;
                  syncNote = 'TopupNation is currently processing the order';
                }
                if (order) {
                  order.state = state;
                  order.statusText = statusUpper;
                  await order.save();
                }
              }
            } catch (fallbackErr) {
              // Ignore fallback error
            }
          }
          if (!syncNote) {
            syncNote = order ? `Processing (${order.statusText || 'In Progress'})` : 'Live processing in progress';
          }
        }
      }

      const stateMap: Record<number, { statusText: string; icon: string; message: string }> = {
        0: { statusText: 'PENDING', icon: '⏳', message: 'Order created, awaiting transaction' },
        1: { statusText: 'PROCESSING', icon: '🔄', message: isTopupNationOrder ? 'TopupNation API delivering top-up' : 'LootBar API delivering top-up' },
        2: { statusText: 'COMPLETED', icon: '✅', message: 'Order completed successfully' },
        3: { statusText: 'FAILED', icon: '❌', message: 'Order failed on game server (Refunded)' },
        4: { statusText: 'SETTLING', icon: '⚡', message: 'Transaction in settlement stage' },
        5: { statusText: 'PARTIAL', icon: '⚠️', message: 'Order partially fulfilled' },
        6: { statusText: 'CANCELLED', icon: '🚫', message: 'Order was cancelled' }
      };

      const status = stateMap[state] || { statusText: 'PROCESSING', icon: '⏳', message: syncNote || 'In progress' };
      const checkedAt = formatMyanmarDateTime(new Date());

      let playerName = isValidValue(order?.playerName) ? String(order?.playerName).trim() : '';
      let playerId = '';
      let serverId = '';
      const otherDetails: { key: string; val: string }[] = [];

      if (order?.extraInfo && typeof order.extraInfo === 'object') {
        for (const [k, v] of Object.entries(order.extraInfo)) {
          if (!isValidValue(v)) continue;
          if (k === 'paymentSource' || k === 'provider') continue;
          const lk = k.toLowerCase();
          if (!playerId && (lk === 'uid' || lk === 'userid' || lk === 'user_id' || lk === 'player_id' || lk === 'account_id' || lk === 'useraccount')) {
            playerId = String(v).trim();
          } else if (!serverId && (lk === 'zoneid' || lk === 'zone_id' || lk === 'server' || lk === 'server_id' || lk === 'serverid')) {
            serverId = String(v).trim();
          } else if (!playerName && (lk === 'player_name' || lk === 'role_name' || lk === 'nickname' || lk === 'playername' || lk === 'role')) {
            playerName = String(v).trim();
          } else {
            otherDetails.push({ key: k.toUpperCase(), val: String(v).trim() });
          }
        }
      }

      const safeGameName = escapeMd(order?.gameName || 'Game');
      const safeSkuName = escapeMd(order?.skuName || 'Package');
      const targetRefId = order?.providerOrderId || order?.orderId || order?.referenceId || cleanId;

      const lines: string[] = [];
      lines.push(`📡 *Live Order Status*`);
      lines.push(`═════════════════════════`);
      lines.push(`├── 🆔 Order ID: \`${orderId || targetRefId}\``);
      lines.push(`├── 🌐 Provider: \`${isTopupNationOrder ? 'TopupNation API' : 'LootBar API'}\``);
      lines.push(`├── 🎮 Game: *${safeGameName}*`);
      lines.push(`├── 📦 Package: *${safeSkuName}*`);
      if (isValidValue(playerName)) {
        lines.push(`├── 👤 Player: \`${escapeCode(playerName)}\``);
      }
      if (isValidValue(playerId)) {
        lines.push(`├── 🎯 Player ID: \`${escapeCode(playerId)}\``);
      }
      if (isValidValue(serverId)) {
        lines.push(`├── 🌐 Server ID: \`${escapeCode(serverId)}\``);
      }
      for (const item of otherDetails) {
        if (isValidValue(item.val)) {
          lines.push(`├── ▫️ ${escapeMd(item.key)}: \`${escapeCode(item.val)}\``);
        }
      }
      lines.push(`├── ${status.icon} Status: *${status.statusText}*`);
      lines.push(`├── 💬 Message: _${escapeMd(syncNote || status.message)}_`);
      if (order?.price) {
        lines.push(`├── 💰 Price: \`$${Number(order.price).toFixed(3)}\``);
      }
      lines.push(`└── 🕒 Checked At: \`${checkedAt}\``);
      lines.push(`═════════════════════════`);

      const updateMsg = lines.join('\n');

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🔄 Refresh Status Again', `track_order_${targetRefId}`),
          Markup.button.callback('📜 Order History', 'view_orders_action')
        ]
      ]);

      if (isCallback) {
        await safeEditMessageText(ctx, updateMsg, keyboard);
      } else {
        await safeReply(ctx, updateMsg, keyboard);
      }
    } catch (err: any) {
      console.error('Error tracking order status:', err);
      if (isCallback) {
        try { await ctx.answerCbQuery('Status synced'); } catch {}
      }
      await safeReply(
        ctx, 
        `📡 *Live Order Status*\n═════════════════════════\n├── 🆔 Order: \`${escapeCode(cleanId)}\`\n├── 🔄 Status: *PROCESSING*\n└── 💬 Message: _Order is being processed on provider server_\n═════════════════════════`, 
        Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Refresh Status Again', `track_order_${cleanId}`),
            Markup.button.callback('📜 Order History', 'view_orders_action')
          ]
        ])
      );
    }
  }

  // Live order status tracking callback from inline button
  bot.action(/^track_order_(.+)$/, async (ctx) => {
    const referenceId = ctx.match[1];
    return await handleTrackOrderQuery(ctx, referenceId, true);
  });

  bot.action('view_orders_action', async (ctx) => {
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx, false);
  });

  // If not serverless, start polling mode in background
  if (!options.isServerless) {
    bot.launch({ dropPendingUpdates: true }).catch(err => {
      console.error("Failed to launch bot. Is the TELEGRAM_BOT_TOKEN valid?", err?.message || err);
    });
    console.log("Telegram bot initialized in Long-Polling mode (VPS / Continuous Server).");
  } else {
    console.log("Telegram bot initialized in Webhook / Serverless mode.");
    if (options.webhookUrl) {
      bot.telegram.setWebhook(options.webhookUrl).then(() => {
        console.log(`Telegram webhook set to: ${options.webhookUrl}`);
      }).catch(err => {
        console.error("Failed to set Telegram webhook:", err?.message || err);
      });
    }
  }
  
  return bot;
}
