import { Telegraf, Markup, Context } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { LootBarClient } from './lootbar';
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

async function getAdminChatId(defaultId: string | undefined): Promise<string | undefined> {
  try {
    const config = await AppConfig.findOne({ key: 'admin_chat_id' });
    return config?.value || defaultId;
  } catch { return defaultId; }
}


// We augment the session context to keep track of conversation state
interface SessionData {
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
}

export interface MyContext extends Context {
  session: SessionData;
}

export function setupBot(
  botToken: string, 
  adminChatId: string | undefined, 
  lootbar: LootBarClient,
  options: { isServerless?: boolean; webhookUrl?: string } = {}
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
    ['🎮 Game List'],
    ['👤 My Account', '💰 Request Top-Up'],
    ['📜 Order History']
  ]).resize();

  bot.command('start', async (ctx) => {
    ctx.session = {}; // reset session
    return ctx.reply(
      '🎮 *Welcome to the Game Top-Up Bot!*\n\n' +
      'ရရှိနိုင်သော Game များကို ကြည့်ရန် အောက်ပါ Menu မှ *🎮 Game List* ကို နှိပ်ပါ (သို့မဟုတ် /games ဟု ပို့ပါ)။\n\n' +
      '⚡ *အသုံးပြုနည်း အမြန်လမ်းညွှန်:*\n' +
      '• Game ၏ Products စာရင်း ကြည့်ရန်: `.<shortKey>` (ဥပမာ `.p` သို့မဟုတ် `.ml`)\n' +
      '• အော်ဒါ တိုက်ရိုက်တင်ရန်: `.<shortKey> <Account ID> <Product>`\n' +
      '👉 _ဥပမာ:_ `.p 5123456789 60`',
      {
        parse_mode: 'Markdown',
        ...mainMenu
      }
    );
  });

  // Text-only Game List handler (No buttons)
  async function renderTextGameList(ctx: MyContext) {
    try {
      let savedGames = await SavedGame.find({}).sort({ savedAt: -1 });

      if (!savedGames || savedGames.length === 0) {
        const response = await lootbar.getGames();
        const allGames = response?.data?.items || [];
        if (allGames.length > 0) {
          for (const g of allGames.slice(0, 6)) {
            const gId = String(g.id || g.game_id);
            const gName = g.name || g.game_name || 'Game';
            const shortKey = getGameDefaultShortKey(gName, gId);
            await SavedGame.findOneAndUpdate(
              { gameId: gId },
              { name: gName, shortKey },
              { upsert: true, new: true }
            );
          }
          savedGames = await SavedGame.find({}).sort({ savedAt: -1 });
        }
      }

      if (!savedGames || savedGames.length === 0) {
        return ctx.reply('⚠️ No games active currently. Please enable games from the Web Dashboard.');
      }

      let msg = `🎮 *ရရှိနိုင်သော Games စာရင်း (Available Games)*\n\n` +
        `အောက်ပါ Game များအား Top-Up ဝယ်ယူနိုင်ပါသည်။ Product စာရင်း ကြည့်ရှုရန် သို့မဟုတ် အော်ဒါတင်ရန် သက်ဆိုင်ရာ *Short Key* ဖြင့် အသုံးပြုနိုင်ပါသည်-\n\n`;

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
        `• Game တစ်ခုချင်းစီ၏ ဈေးနှုန်းနှင့် Package များ ကြည့်ရှုရန် \`.\` နောက်တွင် short key ရိုက်ပို့ပါ (ဥပမာ: \`.p\` သို့မဟုတ် \`.ml\`)\n` +
        `• တိုက်ရိုက် Order တင်ရန် \`.\` short key နောက်တွင် account ID နှင့် product ရိုက်ပို့ပါ (ဥပမာ: \`.p 5123456789 60\`)`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Failed to fetch text game list:', error);
      return ctx.reply(`An error occurred while fetching the game list: ${error.message}`);
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

      if (args.length < minFields + 1) {
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

      const rawProductQuery = args.slice(minFields).join(' ').trim();
      const productQuery = rawProductQuery.toLowerCase().replace(/uc|diamond|diamonds|dm|gem|gems/g, '').trim();

      ctx.session = {};
      ctx.session.gameId = gameId;
      ctx.session.gameName = gameName;
      ctx.session.extraInfo = extraInfo;
      ctx.session.skus = skus;

      // Match SKU
      const numbersInQuery = productQuery.match(/\d+/g);
      let matchedSku = skus.find((s: any) => {
        const name = (s.sku_name || '').toLowerCase();
        const numbersInName = name.match(/\d+/g);
        if (numbersInQuery && numbersInName && numbersInName.includes(numbersInQuery[0])) {
          return true;
        }
        return name.includes(productQuery);
      });

      if (!matchedSku) {
        // Show available packages for quick selection
        const buttons = skus.map((sku: any) => {
          const name = sku.sku_name || 'Unknown Item';
          const price = sku.reseller_price || sku.price ? ` ($${sku.reseller_price || sku.price})` : '';
          return [Markup.button.callback(`${name}${price}`, `q_order_${gameId}_${sku.sku_id}`)];
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

  // Universal Short Key Listener (e.g. .p, .ml, .ff, /p, etc.)
  bot.hears(/^[./]([a-zA-Z0-9_-]+)(\s+.*)?$/i, async (ctx, next) => {
    const text = ctx.message.text.trim();
    const match = text.match(/^[./]([a-zA-Z0-9_-]+)(\s+.*)?$/i);
    if (!match) return next();

    const inputKey = match[1].toLowerCase();
    const rawArgs = match[2] ? match[2].trim().split(/\s+/) : [];

    // Skip reserved commands like /start, /cancel, /auth, /unauth, /users, /addbalance, /orders, /balance, /games, /account, /profile, /wallet, /topup, /deposit
    const reservedCommands = ['start', 'cancel', 'auth', 'unauth', 'users', 'addbalance', 'orders', 'balance', 'games', 'help', 'account', 'profile', 'wallet', 'myaccount', 'mywallet', 'mybalance', 'topup', 'deposit', 'requesttopup', 'requestbalance', 'addmoney'];
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
            shortKey: inputKey
          } as any;
        }
      }

      if (!matchedGame) {
        return next(); // Not a game short key, pass along
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
    const clickerUser = await User.findOne({ telegramChatId: Number(clickerChatId) });

    if (clickerChatId !== currentAdminId && !clickerUser?.receivesNotifications) {
      return ctx.answerCbQuery('🚫 Unauthorized', { show_alert: true });
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
    await safeEditMessageText(
      ctx,
      `✅ *Top-Up Request Approved!*\n\n` +
      `🆔 *Request ID:* \`${requestId}\`\n` +
      `👤 *User:* \`${topupReq.telegramChatId}\`\n` +
      `💵 *Amount Added:* \`+$${topupReq.amount.toFixed(2)} USD\`\n` +
      `💳 *New Balance:* \`$${Number(updatedUser?.balance || 0).toFixed(2)} USD\`\n` +
      `👤 *Approved by:* \`${clickerChatId}\`\n` +
      `📅 *Time:* ${new Date().toLocaleString()}`
    );

    // Notify user in their Telegram chat
    const userSuccessMsg = `🎉 *Balance Top-Up Approved!*\n\n` +
      `💰 *Added Amount:* \`+$${topupReq.amount.toFixed(2)} USD\`\n` +
      `💳 *New Wallet Balance:* \`$${Number(updatedUser?.balance || 0).toFixed(2)} USD\`\n` +
      `🆔 *Request ID:* \`${requestId}\`\n\n` +
      `သင့် Wallet ထဲသို့ ငွေဖြည့်သွင်းခြင်း အောင်မြင်ပါပြီ။ အော်ဒါများကို စတင်ဝယ်ယူနိုင်ပါပြီ။`;

    await safeSendMessage(bot.telegram, topupReq.telegramChatId, userSuccessMsg, mainMenu);
  });

  // Admin Action: Reject Balance Top-Up Request
  bot.action(/^topup_reject_(TR-[A-Z0-9]+)$/, async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    const clickerChatId = String(ctx.chat?.id || ctx.from?.id);
    const clickerUser = await User.findOne({ telegramChatId: Number(clickerChatId) });

    if (clickerChatId !== currentAdminId && !clickerUser?.receivesNotifications) {
      return ctx.answerCbQuery('🚫 Unauthorized', { show_alert: true });
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

    await ctx.answerCbQuery('❌ Top-up request rejected.');
    await safeEditMessageText(
      ctx,
      `❌ *Top-Up Request Rejected*\n\n` +
      `🆔 *Request ID:* \`${requestId}\`\n` +
      `👤 *User:* \`${topupReq.telegramChatId}\`\n` +
      `💵 *Amount:* \`$${topupReq.amount.toFixed(2)} USD\`\n` +
      `👤 *Rejected by:* \`${clickerChatId}\`\n` +
      `📅 *Time:* ${new Date().toLocaleString()}`
    );

    // Notify user
    const userRejectMsg = `❌ *Top-Up Request Declined*\n\n` +
      `💰 *Requested Amount:* \`$${topupReq.amount.toFixed(2)} USD\`\n` +
      `🆔 *Request ID:* \`${requestId}\`\n\n` +
      `သင့် ငွေဖြည့်သွင်းမှု တောင်းဆိုချက်ကို Admin မှ ပယ်ဖျက်လိုက်ပါသည်။ အသေးစိတ်သိရှိလိုပါက Admin သို့ ဆက်သွယ်ပါ။`;

    await safeSendMessage(bot.telegram, topupReq.telegramChatId, userRejectMsg, mainMenu);
  });

  async function renderAccountProfile(ctx: MyContext) {
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    if (!user) return ctx.reply('User not found.');
    
    const currentAdminId = await getAdminChatId(adminChatId);
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user.useDirectApiBalance || user.balanceMode === 'api');

    const usernameDisplay = user.username 
      ? `@${escapeMd(user.username)}` 
      : user.firstName 
        ? escapeMd(user.firstName) 
        : 'Not set';

    let msg = `👤 *My Account Profile*\n\n` +
      `🆔 *Chat ID:* \`${ctx.chat!.id}\`\n` +
      `👤 *Username:* ${usernameDisplay}\n` +
      `📊 *Status:* ✅ \`Authorized\`\n`;

    if (isApiLinked) {
      msg += `⚡ *Account Tier:* \`Direct API Linked (VIP / Reseller)\`\n` +
        `💳 *Wallet Mode:* \`Direct API Live Balance (Auto-Sync)\`\n`;
      try {
        const asset = await lootbar.queryAsset();
        const apiBalance = asset?.data?.total_amount || asset?.data?.balance || '0.00';
        msg += `💰 *Live API Wallet Balance:* \`$${apiBalance} USD\`\n` +
          `🚀 *Ordering Mode:* \`Direct API Fulfillment\`\n\n` +
          `_✨ Your account is directly connected to the LootBar API wallet balance. Top-up orders are processed directly against live API funds._`;
      } catch (e: any) {
        msg += `💰 *Live API Wallet Balance:* \`Active (Live Connected)\`\n\n` +
          `_✨ Your account is directly connected to the live API balance._`;
      }
    } else {
      msg += `⚡ *Account Tier:* \`Standard Member\`\n` +
        `💰 *Wallet Balance:* \`$${Number(user.balance || 0).toFixed(2)} USD\`\n` +
        `📦 *Ordering Mode:* \`Pre-funded Wallet Balance\``;
    }
    
    if (isOwner && !isApiLinked) {
      try {
        const asset = await lootbar.queryAsset();
        const apiBalance = asset?.data?.total_amount || asset?.data?.balance || '0.00';
        msg += `\n\n👑 *Owner LootBar API Balance:* \`$${apiBalance} USD\``;
      } catch (e: any) {
        msg += `\n\n👑 *Owner LootBar API Balance:* \`Error (${escapeMd(e.message)})\``;
      }
    }
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Request Balance Top-Up', 'topup_flow_start')]
    ]);

    return await safeReply(ctx, msg, keyboard);
  }

  async function renderBalance(ctx: MyContext) {
    const currentAdminId = await getAdminChatId(adminChatId);
    const user = await User.findOne({ telegramChatId: ctx.chat!.id });
    const isOwner = String(ctx.chat!.id) === currentAdminId;
    const isApiLinked = !!(user?.useDirectApiBalance || user?.balanceMode === 'api');

    if (isApiLinked) {
      try {
        const asset = await lootbar.queryAsset();
        const apiBalance = asset?.data?.total_amount || asset?.data?.balance || '0.00';
        const msg = `⚡ *Direct API Balance Linked (VIP / Reseller)*\n\n` +
          `💰 *Live API Wallet Balance:* \`$${apiBalance} USD\`\n` +
          `💳 *Wallet Mode:* \`Direct API Balance Sync\`\n` +
          `✨ *Status:* Connected directly to live LootBar API funds.\n` +
          `🚀 You can place top-up orders directly anytime.`;
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('💰 Request Balance Top-Up', 'topup_flow_start')]
        ]);
        return await safeReply(ctx, msg, keyboard);
      } catch (e: any) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('💰 Request Balance Top-Up', 'topup_flow_start')]
        ]);
        return await safeReply(ctx, `⚡ *Account Mode:* \`Direct API Balance Linked\`\n💰 *API Wallet:* \`Active (Live Connected)\`\n✨ Live balance linked directly to LootBar API.`, keyboard);
      }
    }

    let msg = `💰 *Your Wallet Balance:* \`$${Number(user?.balance || 0).toFixed(2)} USD\``;
    
    if (isOwner) {
      try {
        const asset = await lootbar.queryAsset();
        const apiBalance = asset?.data?.total_amount || asset?.data?.balance || '0.00';
        msg += `\n👑 *Owner LootBar API Balance:* \`$${apiBalance} USD\``;
      } catch (e: any) {
        msg += `\n👑 *Owner LootBar API Balance:* \`Error (${escapeMd(e.message)})\``;
      }
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💰 Request Balance Top-Up', 'topup_flow_start')]
    ]);
    return await safeReply(ctx, msg, keyboard);
  }

  bot.hears(['👤 My Account', 'My Account', 'Account', 'account', '👤 Profile', 'Profile', 'profile', '👤 My Profile'], async (ctx) => {
    return await renderAccountProfile(ctx);
  });

  bot.command(['account', 'profile', 'myaccount', 'myprofile'], async (ctx) => {
    return await renderAccountProfile(ctx);
  });

  bot.hears(['💳 My Balance', 'My Balance', 'Balance', 'balance', 'Wallet', 'wallet', '💳 Wallet', '💰 Balance'], async (ctx) => {
    return await renderBalance(ctx);
  });

  bot.command(['balance', 'wallet', 'mybalance', 'mywallet'], async (ctx) => {
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

  async function submitTopupRequest(ctx: MyContext, amount: number, note: string = '') {
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
        status: 'pending'
      });
    } catch (e) {
      console.error('Failed to create TopupRequest record:', e);
    }

    // Confirmation message to User
    const userConfirmMsg = `✅ *Top-Up Request Submitted!*\n\n` +
      `🆔 *Request ID:* \`${requestId}\`\n` +
      `💰 *Requested Amount:* \`$${amount.toFixed(2)} USD\`\n` +
      (note ? `📝 *Note / Ref:* \`${escapeCode(note)}\`\n` : '') +
      `💳 *Current Wallet Balance:* \`$${Number(user.balance || 0).toFixed(2)} USD\`\n\n` +
      `Admin ထံသို့ အကြောင်းကြားစာ ပို့ပြီးပါပြီ။ Admin မှ စစ်ဆေးအတည်ပြုပြီးပါက သင့် Wallet ထဲသို့ Balance တိုက်ရိုက်ထည့်သွင်းပေးပါမည်။`;

    await safeReply(ctx, userConfirmMsg, mainMenu);

    // Notify Admin & notification receivers
    const currentAdminId = await getAdminChatId(adminChatId);
    const userDisplay = fromUsername ? `@${escapeMd(fromUsername)}` : (fromFirstName ? escapeMd(fromFirstName) : 'User');
    const safeNote = note ? escapeCode(note) : 'None';

    const adminNotificationMsg = `🔔 *New Balance Top-Up Request!*\n\n` +
      `🆔 *Request ID:* \`${requestId}\`\n` +
      `👤 *User:* \`${chatId}\` (${userDisplay})\n` +
      `💵 *Requested Amount:* \`$${amount.toFixed(2)} USD\`\n` +
      `💳 *Current Balance:* \`$${Number(user.balance || 0).toFixed(2)} USD\`\n` +
      `📝 *Note / Ref:* \`${safeNote}\`\n` +
      `📅 *Time:* ${new Date().toLocaleString()}\n\n` +
      `အောက်ပါ ခလုတ်များကို နှိပ်၍ အတည်ပြုနိုင်ပါသည်:`;

    const adminKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`✅ Approve & Add $${amount.toFixed(2)}`, `topup_approve_${requestId}`),
        Markup.button.callback(`❌ Reject`, `topup_reject_${requestId}`)
      ]
    ]);

    if (currentAdminId) {
      await safeSendMessage(bot.telegram, currentAdminId, adminNotificationMsg, adminKeyboard);
    }

    try {
      const notifyUsers = await User.find({ receivesNotifications: true });
      for (const u of notifyUsers) {
        if (String(u.telegramChatId) === currentAdminId) continue;
        await safeSendMessage(bot.telegram, u.telegramChatId, adminNotificationMsg, adminKeyboard);
      }
    } catch (err) {
      console.error('Failed to notify admins of topup request:', err);
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
    ctx.session.step = 'INPUT_TOPUP_NOTE';

    await ctx.answerCbQuery(`Selected $${amount.toFixed(2)} USD`);

    const promptMsg = `💰 *Selected Amount:* \`$${amount.toFixed(2)} USD\`\n\n` +
      `📝 ကျေးဇူးပြု၍ Payment Reference / Transaction No. သို့မဟုတ် Note (ဥပမာ: \`KPay Ref: 123456\` သို့မဟုတ် \`KBZPay\`) ရိုက်ထည့်ပေးပါ:\n\n` +
      `_Note မထည့်လိုပါက အောက်ပါ Skip ခလုတ်ကို နှိပ်နိုင်ပါသည်။_`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏩ Skip Note & Submit (တန်းတင်မည်)', `topup_skip_note_${amount}`)],
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

  bot.action(/^topup_skip_note_(\d+(\.\d+)?)$/, async (ctx) => {
    const amount = parseFloat(ctx.match[1]);
    await ctx.answerCbQuery('Submitting top-up request...');
    return await submitTopupRequest(ctx, amount, '');
  });

  bot.action('cancel_topup', async (ctx) => {
    ctx.session = {};
    await ctx.answerCbQuery('Cancelled');
    await safeEditMessageText(ctx, '❌ Top-up request cancelled.');
  });

  async function renderOrderHistory(ctx: MyContext, isEdit: boolean = false) {
    const orders = await Order.find({ telegramChatId: ctx.chat!.id }).sort({ createdAt: -1 }).limit(10);
    if (orders.length === 0) {
      if (isEdit) {
        return await safeEditMessageText(ctx, '📜 No recent top-up orders found.');
      }
      return await safeReply(ctx, '📜 No recent top-up orders found.');
    }

    const stateMap: Record<number, string> = {
      1: '⏳ In Processing',
      2: '✅ Completed (Success)',
      3: '❌ Failed (Refunded)',
      4: '⏳ Settling',
      5: '⚠️ Partial Fulfillment',
      6: '🚫 Cancelled',
      7: '🗑 Deleted'
    };

    let msg = `📜 *Your Recent Top-Up Orders (${orders.length})*\n\n`;

    orders.forEach((o, i) => {
      const safeGame = escapeMd(o.gameName || 'Game');
      const safeSku = escapeMd(o.skuName || `Product #${o.skuId}`);
      const priceText = o.price ? `$${Number(o.price).toFixed(2)} USD` : 'N/A';
      const statusText = stateMap[o.state] || '⏳ Processing';
      const dateText = new Date(o.createdAt).toLocaleString();
      const isApiOrder = o.extraInfo?.paymentSource === 'api_balance';

      let extraDetails = '';
      if (o.extraInfo && Object.keys(o.extraInfo).length > 0) {
        for (const [key, val] of Object.entries(o.extraInfo)) {
          if (key === 'paymentSource') continue;
          extraDetails += `   ▫️ *${escapeMd(key.toUpperCase())}:* \`${escapeCode(val)}\`\n`;
        }
      }

      msg += `━━━━━━━━━━━━━━━━━━━━\n` +
        `🧾 *Order #${i + 1}*\n` +
        `🎮 *Game:* ${safeGame}\n` +
        `🛍 *Product:* ${safeSku}\n` +
        (o.playerName ? `🎯 *Player Name (IGN):* \`${escapeCode(o.playerName)}\`\n` : '') +
        (extraDetails ? `👤 *Account Details:*\n${extraDetails}` : '') +
        `💵 *သုံးငွေ (Paid):* \`${priceText}\`\n` +
        `💳 *Payment:* \`${isApiOrder ? '⚡ Direct API Balance Linked' : 'Wallet Balance'}\`\n` +
        `📊 *Status:* ${statusText}\n` +
        `🔖 *Ref ID:* \`${o.referenceId}\`\n` +
        (o.orderId ? `🆔 *LootBar ID:* \`${o.orderId}\`\n` : '') +
        `📅 *Date:* ${dateText}\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Refresh Status', 'refresh_order_history')]
    ]);

    if (isEdit) {
      return await safeEditMessageText(ctx, msg, keyboard);
    }
    return await safeReply(ctx, msg, keyboard);
  }

  bot.hears(['📜 Order History', 'Order History', 'Orders', 'orders', '📜 Orders'], async (ctx) => {
    return await renderOrderHistory(ctx);
  });

  bot.command(['orders', 'history', 'orderhistory'], async (ctx) => {
    return await renderOrderHistory(ctx);
  });

  bot.action('refresh_order_history', async (ctx) => {
    await ctx.answerCbQuery('Refreshing order history...');
    return await renderOrderHistory(ctx, true);
  });

  bot.hears('🎮 Game List', async (ctx) => {
    return await renderTextGameList(ctx);
  });

  bot.command('games', async (ctx) => {
    return await renderTextGameList(ctx);
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
      ctx.session.step = 'INPUT_TOPUP_NOTE';

      const promptMsg = `💰 *Selected Amount:* \`$${parsedAmount.toFixed(2)} USD\`\n\n` +
        `📝 ကျေးဇူးပြု၍ Payment Reference / Transaction No. သို့မဟုတ် Note (ဥပမာ: \`KPay Ref: 123456\` သို့မဟုတ် \`KBZPay\`) ရိုက်ထည့်ပေးပါ:\n\n` +
        `_Note မထည့်လိုပါက အောက်ပါ Skip ခလုတ်ကို နှိပ်ပါ:_`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⏩ Skip Note & Submit (တန်းတင်မည်)', `topup_skip_note_${parsedAmount}`)],
        [Markup.button.callback('❌ Cancel', 'cancel_topup')]
      ]);

      return safeReply(ctx, promptMsg, keyboard);
    }

    // Top-up flow: Note input
    if (ctx.session?.step === 'INPUT_TOPUP_NOTE') {
      const amount = ctx.session.topupAmount || 0;
      if (amount <= 0) {
        ctx.session = {};
        return safeReply(ctx, '❌ Top-up session expired. Please start again from menu.', mainMenu);
      }
      return await submitTopupRequest(ctx, amount, userInput);
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

    let extraDetails = '';
    for (const [key, val] of Object.entries(extraInfo)) {
      extraDetails += `• *${key.toUpperCase()}:* \`${val}\`\n`;
    }

    if (playerName) {
      extraDetails += `• *PLAYER NAME (IGN):* \`${playerName}\` 🎯\n`;
    }

    const balanceAfter = userBalance - price;

    let msg = `📋 *Order Review & Confirmation*\n\n` +
      `🎮 *Game:* ${gameName}\n` +
      `🛍 *Product:* ${skuName}\n` +
      `💰 *Price (သုံးငွေ):* \`$${price.toFixed(2)} USD\`\n\n` +
      `👤 *Top-Up Account Details:*\n${extraDetails}\n`;

    if (isApiLinked) {
      msg += `⚡ *Payment Source:* \`Direct API Balance Linked (VIP Direct)\`\n` +
        `💳 *Wallet Mode:* \`Live API Funds (Direct Execution)\`\n` +
        `🚀 *Order Processing:* Live API Dispatch\n\n`;
    } else {
      msg += `💳 *Your Wallet Balance:* \`$${userBalance.toFixed(2)} USD\`\n` +
        `💵 *Order Cost (သုံးငွေ):* \`$${price.toFixed(2)} USD\`\n` +
        `💰 *Remaining After Order (ကျန်ငွေ):* \`$${balanceAfter.toFixed(2)} USD\`\n\n`;

      if (userBalance < price) {
        msg += `⚠️ *Insufficient Balance!* You need \`$${(price - userBalance).toFixed(2)} USD\` more to place this order.`;
        return ctx.reply(msg, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'cancel_order')]
          ])
        });
      }
    }

    msg += `Please confirm if you would like to place this top-up order now:`;

    return ctx.reply(msg, {
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
    ctx.session.step = 'DONE';
    await ctx.reply('⏳ Processing your top-up order with LootBar API, please wait...');
    
    const referenceId = uuidv4().replace(/-/g, '').substring(0, 32);
    const gameId = ctx.session.gameId!;
    const skuId = ctx.session.skuId!;
    const gameName = ctx.session.gameName || 'Game';
    const skuName = ctx.session.skuName || 'Product';
    const playerName = ctx.session.playerName || undefined;
    const extraInfo = ctx.session.extraInfo || {};
    
    const userDoc = await User.findOne({ telegramChatId: ctx.chat!.id });
    if (!userDoc) {
      return ctx.reply('❌ User account not found.');
    }
    
    const isApiLinked = !!(userDoc.useDirectApiBalance || userDoc.balanceMode === 'api');
    let orderCost = ctx.session.skuPrice || 1;

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
            Markup.button.callback('🔄 Check Live API Status', `track_order_${referenceId}`),
            Markup.button.callback('📜 Order History', 'view_orders_action')
          ]
        ]);

        let extraDetailsText = '';
        if (extraInfo && Object.keys(extraInfo).length > 0) {
          for (const [k, v] of Object.entries(extraInfo)) {
            extraDetailsText += `   ▫️ *${escapeMd(k.toUpperCase())}:* \`${escapeCode(v)}\`\n`;
          }
        }

        const safeGame = escapeMd(gameName);
        const safeSku = escapeMd(skuName);

        let apiLiveBalance = '';
        if (isApiLinked) {
          try {
            const asset = await lootbar.queryAsset();
            apiLiveBalance = asset?.data?.total_amount || asset?.data?.balance || '';
          } catch {}
        }

        const successMsg = `✅ *Top-Up Order Dispatched to API!*\n\n` +
          `🎮 *Game:* ${safeGame}\n` +
          `🛍 *Product:* ${safeSku}\n` +
          (playerName ? `🎯 *Player Name (IGN):* \`${escapeCode(playerName)}\`\n` : '') +
          (extraDetailsText ? `👤 *Account Info:*\n${extraDetailsText}` : '') +
          `\n━━━━━━━━━━━━━━━━━━━━\n` +
          `💵 *Wallet သုံးငွေ (Amount Paid):* \`$${orderCost.toFixed(2)} USD\`\n` +
          (isApiLinked 
            ? (apiLiveBalance ? `💰 *API Wallet ကျန်ငွေ (Remaining):* \`$${apiLiveBalance} USD\`\n` : `💰 *API Wallet:* \`Live Connected\`\n`)
            : `💰 *Wallet ကျန်ငွေ (Remaining Balance):* \`$${userDoc.balance.toFixed(2)} USD\`\n`
          ) +
          `💳 *Payment Source:* \`${isApiLinked ? '⚡ Direct API Balance Linked' : 'Wallet Balance'}\`\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🔖 *Reference ID:* \`${referenceId}\`\n` +
          `🆔 *LootBar Order ID:* \`${orderId}\`\n\n` +
          `📊 *Real-Time API Status:*\n` +
          `• ⏳ *Stage:* \`Processing (In Transaction)\`\n` +
          `• 📡 *LootBar Response:* \`State 1 - Order Accepted & Transacting\`\n` +
          `• ⏱ *Delivery:* Usually delivers in 15 seconds – 2 minutes.\n\n` +
          `_You can tap below anytime to check live delivery status:_`;

        await safeReply(ctx, successMsg, statusKeyboard);
        
        // Notify Admins
        const currentAdminIdForNotify = await getAdminChatId(adminChatId);
        const fromUser = ctx.from?.username 
          ? `@${ctx.from.username}` 
          : (ctx.chat as any)?.username 
            ? `@${(ctx.chat as any).username}` 
            : ctx.from?.first_name 
              ? ctx.from.first_name 
              : 'User';

        const safeFromUser = escapeMd(fromUser);
        const safeDetails = escapeCode(JSON.stringify(extraInfo));

        const notificationMsg = `🔔 *New Top-up Order Received!*\n\n` +
          `👤 *User:* \`${ctx.chat!.id}\` (${safeFromUser})\n` +
          `🎮 *Game:* ${safeGame}\n` +
          `🛍 *Product:* ${safeSku} ($${orderCost.toFixed(2)})\n` +
          `💳 *Payment:* ${isApiLinked ? '⚡ Direct API Balance Linked' : `Wallet Balance ($${orderCost.toFixed(2)})`}\n` +
          (playerName ? `🎯 *Player Name:* \`${escapeCode(playerName)}\`\n` : '') +
          `🔖 *Ref ID:* \`${referenceId}\`\n` +
          `🆔 *LootBar ID:* \`${orderId}\`\n` +
          `📋 *Details:* \`${safeDetails}\``;
        
        if (currentAdminIdForNotify) {
          await safeSendMessage(bot.telegram, currentAdminIdForNotify, notificationMsg);
        }

        try {
          const notifyUsers = await User.find({ receivesNotifications: true });
          for (const u of notifyUsers) {
            if (String(u.telegramChatId) === currentAdminIdForNotify) continue;
            await safeSendMessage(bot.telegram, u.telegramChatId, notificationMsg);
          }
        } catch (dbErr) {
           console.error('Failed to fetch notification users:', dbErr);
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
                `🎉 *Top-Up Completed!*\n\n` +
                `🎮 *Game:* ${safeGame}\n` +
                `🛍 *Product:* ${safeSku}\n` +
                (playerName ? `🎯 *Player:* \`${escapeCode(playerName)}\`\n` : '') +
                `🔖 *Ref ID:* \`${referenceId}\`\n\n` +
                `✅ Your order has been successfully fulfilled by the game server!`
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
                `❌ *Order Failed*\n\nOrder \`${referenceId}\` could not be completed on game server.${!isApiLinked ? ` Your wallet balance has been refunded ($${orderCost.toFixed(2)} USD).` : ''}`
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

  // Live order status tracking callback from inline button
  bot.action(/^track_order_(.+)$/, async (ctx) => {
    const referenceId = ctx.match[1];
    await ctx.answerCbQuery('📡 Querying live LootBar API status...');

    try {
      const order = await Order.findOne({ referenceId });
      const queryRes = await lootbar.queryOrder(referenceId);
      
      let state = order?.state ?? 1;
      let orderId = order?.orderId || '';

      if (queryRes && queryRes.status === 'ok' && queryRes.data) {
        state = queryRes.data.state !== undefined ? queryRes.data.state : state;
        orderId = queryRes.data.order_id || orderId;
        
        if (order) {
          order.state = state;
          if (orderId) order.orderId = orderId;
          await order.save();
        }
      }

      const stateMap: Record<number, { text: string; emoji: string; desc: string }> = {
        0: { text: 'Pending', emoji: '⏳', desc: 'Order initialized, waiting to process' },
        1: { text: 'Processing (In Transaction)', emoji: '🔄', desc: 'LootBar API is actively delivering top-up to player account' },
        4: { text: 'Settling (Processing)', emoji: '⚡', desc: 'Transaction in final settlement stage' },
        2: { text: 'Completed (Success)', emoji: '✅', desc: 'Top-up has been successfully fulfilled and credited to player account!' },
        3: { text: 'Failed', emoji: '❌', desc: 'Transaction failed on game server. Balance has been refunded.' },
        5: { text: 'Partial', emoji: '⚠️', desc: 'Order was partially fulfilled' },
        6: { text: 'Cancelled', emoji: '🚫', desc: 'Order was cancelled' }
      };

      const currentStatus = stateMap[state] || { text: 'Processing', emoji: '⏳', desc: 'In Progress' };
      const checkedAt = new Date().toLocaleTimeString();

      let extraDetails = '';
      if (order?.extraInfo && Object.keys(order.extraInfo).length > 0) {
        for (const [k, v] of Object.entries(order.extraInfo)) {
          extraDetails += `   ▫️ *${k.toUpperCase()}:* \`${v}\`\n`;
        }
      }

      const safeGameName = escapeMd(order?.gameName || 'Game');
      const safeSkuName = escapeMd(order?.skuName || 'Top-up Package');

      const updateMsg = `📡 *Live Order Status Report*\n\n` +
        `🎮 *Game:* ${safeGameName}\n` +
        `🛍 *Product:* ${safeSkuName}\n` +
        (order?.playerName ? `🎯 *Player Name (IGN):* \`${escapeCode(order.playerName)}\`\n` : '') +
        (extraDetails ? `👤 *Account Info:*\n${extraDetails}` : '') +
        `💰 *Amount Paid:* \`$${Number(order?.price || 0).toFixed(2)} USD\`\n` +
        `🔖 *Reference ID:* \`${referenceId}\`\n` +
        (orderId ? `🆔 *LootBar ID:* \`${orderId}\`\n` : '') +
        `\n━━━━━━━━━━━━━━━━━━━━\n` +
        `📊 *Current API Status:* ${currentStatus.emoji} *${currentStatus.text}*\n` +
        `📝 *Status Note:* ${currentStatus.desc}\n` +
        `🕒 *Last Checked:* \`${checkedAt}\`\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('🔄 Refresh Status Again', `track_order_${referenceId}`),
          Markup.button.callback('📜 Order History', 'view_orders_action')
        ]
      ]);

      await safeEditMessageText(ctx, updateMsg, keyboard);
    } catch (err: any) {
      console.error('Error tracking order status:', err);
      await safeReply(ctx, `⚠️ Could not refresh live status: ${escapeCode(err.message)}`);
    }
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
