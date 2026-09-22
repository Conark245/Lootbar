import { Telegraf, Markup, Context } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { TopupNationService } from './providers/topupnation/TopupNationService';
import { G2BulkService } from './providers/g2bulk/G2BulkService';
import { User } from './models/User';
import { Session } from './models/Session';
import { AppConfig } from './models/AppConfig';
import { TopupNationProduct } from './models/TopupNationProduct';
import { G2BulkProduct } from './models/G2BulkProduct';
import { BotLeaderLock } from './models/BotLeaderLock';

import { MyContext, SessionData } from './bot/types';
import {
  escapeMd,
  escapeCode,
  formatMyanmarDateTime,
  formatMyanmarTimeOnly,
  safeReply,
  safeSendMessage,
  safeEditMessageText,
  safeSendPhoto,
  safeEditMessageCaption,
  parseCommandArgs,
  isProviderApiLinked,
  getGameDefaultShortKey
} from './bot/helpers';

import {
  renderTopupNationGameList,
  handleTopupNationPackageList,
  handleTopupNationDirectOrder,
  syncTopupNationProductLive,
  registerTopupNationHandlers
} from './bot/topupnation';

import {
  renderG2BulkGameList,
  handleG2BulkPackageList,
  handleG2BulkDirectOrder,
  registerG2BulkHandlers
} from './bot/g2bulk';

import {
  registerBulkOrderHandlers,
  handleBulkOrderFlow,
  renderBulkOrderHistory
} from './bot/bulkOrder';

import {
  registerAccountHandlers,
  renderAccountProfile,
  renderBalance,
  startTopupRequest,
  submitTopupRequest
} from './bot/account';

import {
  registerOrderHandlers,
  renderOrderHistory,
  showOrderConfirmation,
  handleTrackOrderQuery
} from './bot/orders';

async function getAdminChatId(defaultId: string | undefined): Promise<string | undefined> {
  try {
    const config = await AppConfig.findOne({ key: 'admin_chat_id' });
    return config?.value || defaultId;
  } catch { return defaultId; }
}

const activeUserOrderLocks = new Map<number | string, number>();
const processedOrderMessages = new Set<string>();
const userLastCommandTime = new Map<number | string, number>();
const userLastCommandText = new Map<number | string, string>();

// Fast in-memory caching to eliminate DB latency on every command/callback
const inMemorySessions = new Map<number, { data: SessionData; lastSavedStr: string }>();
const inMemoryUsers = new Map<number, { user: any; cachedAt: number }>();
let cachedAdminChatId: { id: string | undefined; cachedAt: number } = { id: undefined, cachedAt: 0 };

async function getCachedAdminChatId(defaultId: string | undefined): Promise<string | undefined> {
  const now = Date.now();
  if (now - cachedAdminChatId.cachedAt < 30000) {
    return cachedAdminChatId.id;
  }
  const id = await getAdminChatId(defaultId);
  cachedAdminChatId = { id, cachedAt: now };
  return id;
}

let catalogCache: { tpn: any[]; g2b: any[]; lastFetched: number } = { tpn: [], g2b: [], lastFetched: 0 };

async function getCachedProducts() {
  const now = Date.now();
  if (now - catalogCache.lastFetched < 15000 && (catalogCache.tpn.length > 0 || catalogCache.g2b.length > 0)) {
    return catalogCache;
  }
  const [tpnGames, g2bGames] = await Promise.all([
    TopupNationProduct.find({ isEnabled: { $ne: false }, status: { $ne: 'DISABLED' } }).sort({ name: 1 }).lean(),
    G2BulkProduct.find({ isEnabled: { $ne: false }, status: { $ne: 'DISABLED' } }).sort({ name: 1 }).lean()
  ]);
  catalogCache = { tpn: tpnGames, g2b: g2bGames, lastFetched: now };
  return catalogCache;
}

export function setupBot(
  botToken: string, 
  adminChatId: string | undefined, 
  options: { isServerless?: boolean; webhookUrl?: string } = {},
  topupNation?: TopupNationService,
  g2bulk?: G2BulkService
) {
  const bot = new Telegraf<MyContext>(botToken);
  
  bot.catch((err: any, ctx: Context) => {
    console.error(`Telegram Bot Error (update: ${ctx.updateType}):`, err?.message || err);
  });

  const recentUpdates = new Map<number, number>();
  bot.use(async (ctx, next) => {
    const updateId = ctx.update?.update_id;
    if (updateId) {
      if (recentUpdates.has(updateId)) {
        return;
      }
      recentUpdates.set(updateId, Date.now());
      if (recentUpdates.size > 3000) {
        const threshold = Date.now() - 600000;
        for (const [id, ts] of recentUpdates.entries()) {
          if (ts < threshold) recentUpdates.delete(id);
        }
      }
    }
    return next();
  });
  
  // Fast Session Middleware
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();

    let memSession = inMemorySessions.get(chatId);
    if (!memSession) {
      const sessionDoc = await Session.findOne({ chatId }).lean();
      if (sessionDoc) {
        memSession = { data: (sessionDoc.data as SessionData) || {}, lastSavedStr: JSON.stringify(sessionDoc.data || {}) };
      } else {
        memSession = { data: {}, lastSavedStr: '{}' };
        Session.create({ chatId, data: {} }).catch(() => {});
      }
      inMemorySessions.set(chatId, memSession);
    }

    ctx.session = memSession.data || {};
    
    await next();

    // Async non-blocking session update if changed
    const currentStr = JSON.stringify(ctx.session || {});
    if (currentStr !== memSession.lastSavedStr) {
      memSession.data = ctx.session;
      memSession.lastSavedStr = currentStr;
      Session.updateOne({ chatId }, { data: ctx.session }, { upsert: true }).catch(err => {
        console.error('Session async save error:', err);
      });
    }
  });

  // Fast User Auth Middleware
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();

    const fromUsername = ctx.from?.username || (ctx.chat as any)?.username || undefined;
    const fromFirstName = ctx.from?.first_name || (ctx.chat as any)?.first_name || undefined;
    const now = Date.now();

    let cached = inMemoryUsers.get(chatId);
    let user = cached && (now - cached.cachedAt < 20000) ? cached.user : null;

    if (!user) {
      user = await User.findOne({ telegramChatId: chatId }).lean();
      const currentAdminId = await getCachedAdminChatId(adminChatId);

      if (String(chatId) === currentAdminId) {
        if (!user) {
          user = await User.create({ 
            telegramChatId: chatId, 
            isAuthorized: true,
            username: fromUsername,
            firstName: fromFirstName
          });
        } else if (!user.isAuthorized || (fromUsername && user.username !== fromUsername) || (fromFirstName && user.firstName !== fromFirstName)) {
          user = await User.findOneAndUpdate(
            { telegramChatId: chatId }, 
            { isAuthorized: true, username: fromUsername, firstName: fromFirstName }, 
            { returnDocument: 'after' }
          ).lean();
        }
      } else {
        if (!user) {
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
            { returnDocument: 'after' }
          ).lean();
        }
      }

      if (user) {
        inMemoryUsers.set(chatId, { user, cachedAt: now });
      }
    }

    if (!user || !user.isAuthorized) {
      if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/start')) {
        await ctx.reply(`🚫 You are not authorized to use this bot.\n\nYour Chat ID is: \`${chatId}\`\n\nA request has been sent to the admin. Please wait for approval.`, { parse_mode: 'Markdown' });
        
        const chatObj = ctx.chat as any;
        const currentAdminIdForNotify = await getCachedAdminChatId(adminChatId);
        if (currentAdminIdForNotify) {
          try {
            await bot.telegram.sendMessage(
              currentAdminIdForNotify,
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
      return;
    }

    return next();
  });

  const mainMenu = Markup.keyboard([
    ['🎮 All Games', '⚡ TopupNation'],
    ['🔥 G2Bulk Games', '💳 My Balance'],
    ['👤 My Profile', '📜 Order History'],
    ['📦 Bulk Orders']
  ]).resize();

  async function renderAllGamesList(ctx: MyContext) {
    try {
      const { tpn: tpnGames, g2b: g2bGames } = await getCachedProducts();

      if (tpnGames.length === 0 && g2bGames.length === 0) {
        return ctx.reply('⚠️ No games are currently enabled by the Owner.');
      }

      let msg = `🎮 *ရရှိနိုင်သော Games စာရင်း အားလုံး (All Available Games)*\n\n`;

      if (tpnGames.length > 0) {
        msg += `🌐 *[TopupNation API Games]*\n`;
        tpnGames.forEach(p => {
          const sk = (p.shortKey || `t${p.productId.slice(0, 4)}`).toLowerCase();
          msg += `• *${p.name}* ➔ \`.${sk}\`\n`;
        });
        msg += `\n`;
      }

      if (g2bGames.length > 0) {
        msg += `🔥 *[G2Bulk API Games]*\n`;
        g2bGames.forEach(p => {
          const sk = (p.shortKey || `g${p.productId.slice(0, 4)}`).toLowerCase();
          msg += `• *${p.name}* ➔ \`.${sk}\`\n`;
        });
        msg += `\n`;
      }

      msg += `━━━━━━━━━━━━━━━━━━━━\n` +
        `💡 *အသုံးပြုနည်း:* Package စာရင်းကြည့်ရန် \`.\` နောက်တွင် short key ရိုက်ပို့ပါ (ဥပမာ: \`.tp\`)`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      return ctx.reply(`Error: ${err.message}`);
    }
  }

  // Admin user approval actions
  bot.action(/^approve_user_(\d+)$/, async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat!.id) !== currentAdminId) {
      return ctx.answerCbQuery('Unauthorized');
    }
    const targetChatId = parseInt(ctx.match[1]);
    await User.findOneAndUpdate({ telegramChatId: targetChatId }, { isAuthorized: true });
    await ctx.editMessageText(`✅ User \`${targetChatId}\` approved successfully!`, { parse_mode: 'Markdown' });
    try {
      await bot.telegram.sendMessage(targetChatId, '🎉 Congratulations! Your account has been approved by the Admin.\n\nYou can now use the bot! Tap /start to begin.', mainMenu);
    } catch (e) {}
  });

  bot.action(/^reject_user_(\d+)$/, async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat!.id) !== currentAdminId) {
      return ctx.answerCbQuery('Unauthorized');
    }
    const targetChatId = parseInt(ctx.match[1]);
    await User.findOneAndUpdate({ telegramChatId: targetChatId }, { isAuthorized: false });
    await ctx.editMessageText(`❌ User \`${targetChatId}\` request rejected.`, { parse_mode: 'Markdown' });
  });

  // Basic Commands
  bot.start(async (ctx) => {
    ctx.session = {};
    const welcome = `👋 *Welcome to Multi-Provider Game Top-Up Bot!*\n\n` +
      `⚡ *Supported Direct APIs:* TopupNation, G2Bulk\n\n` +
      `📌 *အသုံးပြုနည်း လမ်းညွှန်:*\n` +
      `• *All Games စာရင်း:* \`/games\` သို့မဟုတ် Menu မှ \`🎮 All Games\`\n` +
      `• *Packages ကြည့်ရန်:* \`.<shortKey>\` (ဥပမာ: \`.p\`, \`.ml\`, \`.tp\`)\n` +
      `• *Direct Order:* \`.<shortKey> <Account> <Product>\`\n` +
      `• *Bulk Order:* \`/bulk\` သို့မဟုတ် စာကြောင်းများစွာ တစ်ပြိုင်နက် ပို့ပါ\n` +
      `• *Live Balance:* \`/balance\` သို့မဟုတ် \`💳 My Balance\`\n` +
      `• *Order Status:* \`/status <OrderID>\``;

    return safeReply(ctx, welcome, mainMenu);
  });

  bot.help(async (ctx) => {
    const helpMsg = `📖 *Bot Commands & Usage Guide*\n═════════════════════════\n` +
      `• \`/games\` — ရရှိနိုင်သော Games အားလုံး စာရင်း\n` +
      `• \`/balance\` — လက်ကျန်ငွေ နှင့် API ချိတ်ဆက်မှု စစ်ဆေးရန်\n` +
      `• \`/profile\` — User Account Profile အချက်အလက်\n` +
      `• \`/orders\` — ယခင် တင်ခဲ့သော အော်ဒါမှတ်တမ်းများ\n` +
      `• \`/bulk\` — Bulk Order အများအပြား တစ်ခါတည်း တင်ရန်\n` +
      `• \`/status <ID>\` — Live Order Status တိုက်ရိုက် စစ်ဆေးရန်\n` +
      `• \`/cancel\` — လုပ်ဆောင်နေသော အော်ဒါ ဖျက်သိမ်းရန်\n` +
      `═════════════════════════`;
    return safeReply(ctx, helpMsg, mainMenu);
  });

  bot.command(['games', 'gamelist', 'allgames'], async (ctx) => {
    return await renderAllGamesList(ctx);
  });

  bot.hears(['🎮 All Games', 'All Games', 'Games', 'games', '🎮 Games'], async (ctx) => {
    return await renderAllGamesList(ctx);
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

  bot.action('main_menu', async (ctx) => {
    ctx.session = {};
    await ctx.answerCbQuery();
    return ctx.reply('🏠 Main Menu:', mainMenu);
  });

  // Universal Short Key Router (.ml, .pubg, .tp, etc.)
  bot.hears(/^[./]([a-zA-Z0-9_-]+)(\s+.*)?$/i, async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.includes('\n')) {
      return await handleBulkOrderFlow(ctx, text);
    }
    const match = text.match(/^[./]([a-zA-Z0-9_-]+)(\s+.*)?$/i);
    if (!match) return next();

    const chatId = ctx.chat?.id;
    if (chatId) {
      const now = Date.now();
      const lastCmd = userLastCommandText.get(chatId);
      const lastTime = userLastCommandTime.get(chatId) || 0;
      if (lastCmd === text && now - lastTime < 3000) {
        return;
      }
      userLastCommandText.set(chatId, text);
      userLastCommandTime.set(chatId, now);
    }

    const inputKey = match[1].toLowerCase();
    const rawArgs = match[2] ? parseCommandArgs(match[2]) : [];

    if (inputKey === 'bulk' || inputKey === 'bulkorder') {
      return await handleBulkOrderFlow(ctx, text);
    }

    const reservedCommands = [
      'start', 'cancel', 'auth', 'unauth', 'users', 'addbalance', 'orders', 'balance',
      'games', 'gamelist', 'help', 'account', 'profile', 'wallet', 'myaccount', 'mywallet',
      'mybalance', 'topup', 'deposit', 'requesttopup', 'requestbalance', 'addmoney',
      'tpn', 'topupnation', 'bulk', 'bulkorder', 'bulkhistory', 'status', 'track'
    ];
    if (reservedCommands.includes(inputKey)) {
      return next();
    }

    try {
      const { tpn: tpnGames, g2b: g2bGames } = await getCachedProducts();

      let matchedTpn = tpnGames.find((p: any) => (p.shortKey && p.shortKey.toLowerCase() === inputKey) || String(p.productId).toLowerCase() === inputKey);
      if (!matchedTpn) {
        matchedTpn = await TopupNationProduct.findOne({
          $or: [{ shortKey: inputKey }, { productId: inputKey }]
        }).lean();
      }

      if (matchedTpn) {
        if (matchedTpn.isEnabled === false || matchedTpn.status === 'DISABLED') {
          return ctx.reply(`⚠️ *${matchedTpn.name}* is currently disabled by Admin.`, { parse_mode: 'Markdown' });
        }

        const activeShortKey = (matchedTpn.shortKey || inputKey).toLowerCase();
        matchedTpn = await syncTopupNationProductLive(matchedTpn, activeShortKey, topupNation);
        if (rawArgs.length === 0) {
          return await handleTopupNationPackageList(ctx, matchedTpn, activeShortKey);
        } else {
          return await handleTopupNationDirectOrder(ctx, matchedTpn, activeShortKey, rawArgs, (c) => showOrderConfirmation(c, topupNation));
        }
      }

      let matchedG2b = g2bGames.find((p: any) => (p.shortKey && p.shortKey.toLowerCase() === inputKey) || String(p.productId).toLowerCase() === inputKey);
      if (!matchedG2b) {
        matchedG2b = await G2BulkProduct.findOne({
          $or: [{ shortKey: inputKey }, { productId: inputKey }]
        }).lean();
      }

      if (matchedG2b) {
        if (matchedG2b.isEnabled === false || matchedG2b.status === 'DISABLED') {
          return ctx.reply(`⚠️ *${matchedG2b.name}* is currently disabled by Admin.`, { parse_mode: 'Markdown' });
        }

        const activeShortKey = (matchedG2b.shortKey || inputKey).toLowerCase();
        if (rawArgs.length === 0) {
          return await handleG2BulkPackageList(ctx, matchedG2b, activeShortKey);
        } else {
          return await handleG2BulkDirectOrder(ctx, matchedG2b, activeShortKey, rawArgs, (c) => showOrderConfirmation(c, topupNation));
        }
      }

      return next();
    } catch (err: any) {
      console.error('Short key processing error:', err);
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // Interactive Question Prompter for wizard-style input
  async function askNextRequiredField(ctx: MyContext) {
    const requiredFields = ctx.session.requiredFields || [];
    const currentIndex = ctx.session.currentFieldIndex || 0;
    const nextField = requiredFields[currentIndex];

    const skuName = ctx.session.skuName || 'Selected Item';
    const price = ctx.session.skuPrice !== undefined ? ctx.session.skuPrice.toFixed(3) : '0.00';
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
      await showOrderConfirmation(ctx, topupNation);
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

      return await submitTopupRequest(bot, ctx, amount, adminChatId, mainMenu, note, photoFileId);
    }

    return next();
  });

  // General Text Input Dispatcher
  bot.on('text', async (ctx, next) => {
    const userInput = ctx.message.text.trim();

    if (userInput.toLowerCase() === 'cancel' || userInput === '/cancel') {
      ctx.session = {};
      return safeReply(ctx, '❌ Cancelled. Main Menu:', mainMenu);
    }

    if (ctx.session?.step === 'INPUT_TOPUP_AMOUNT') {
      const sanitized = userInput.replace(/[$USD,\s]/gi, '');
      const parsedAmount = parseFloat(sanitized);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return safeReply(ctx, '⚠️ ကျေးဇူးပြု၍ မှန်ကန်သော USD ပမာဏကို ဂဏန်းဖြင့်သာ ရိုက်ထည့်ပေးပါ (ဥပမာ: `10`, `25.50`, `100`):\n\n_သို့မဟုတ် /cancel ဖြင့် ဖျက်သိမ်းနိုင်ပါသည်။_');
      }

      ctx.session.topupAmount = parsedAmount;
      ctx.session.step = 'INPUT_TOPUP_PHOTO';

      const promptMsg = `💰 *Selected Top-Up Amount:* \`$${parsedAmount.toFixed(3)} USD\`\n\n` +
        `📸 *Payment Slip Screenshot (ငွေလွှဲပြေစာ ပုံ ပို့ပေးပါ)*\n` +
        `ငွေဖြည့်သွင်းမှု အတည်ပြုရန်အတွက် ငွေလွှဲပြေစာ Screenshot (ဓာတ်ပုံ) ကို ပေးပို့ပေးပါ:\n` +
        `💡 _(ဓာတ်ပုံနှင့်အတူ Caption ဖြင့် KPay Ref သို့မဟုတ် Note ရေးထည့်နိုင်ပါသည်)_\n\n` +
        `⚠️ *ငွေလွှဲပြေစာ ဓာတ်ပုံမပါဘဲ ငွေဖြည့်သွင်းခွင့် တင်၍မရပါ။*`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'cancel_topup')]
      ]);

      return safeReply(ctx, promptMsg, keyboard);
    }

    if (ctx.session?.step === 'INPUT_TOPUP_PHOTO') {
      const amount = ctx.session.topupAmount || 0;
      return safeReply(
        ctx,
        `⚠️ *ငွေလွှဲပြေစာ Screenshot (ဓာတ်ပုံ) ပေးပို့ရန် လိုအပ်ပါသည်*\n\n` +
        `ရွေးချယ်ထားသော ပမာဏ: \`$${amount.toFixed(3)} USD\`\n` +
        `ငွေဖြည့်သွင်းမှု အတည်ပြုနိုင်ရန်အတွက် ငွေလွှဲထားသော ပြေစာပုံ Screenshot ကို Photo အနေဖြင့် ပေးပို့ပေးပါ (Photo Required).\n\n` +
        `_မပြုလုပ်လိုပါက /cancel ဟု ပို့နိုင်ပါသည်။_`
      );
    }

    if (ctx.session?.step === 'INPUT_QUANTITY') {
      const parsedQty = parseInt(userInput.trim(), 10);
      if (isNaN(parsedQty) || parsedQty < 1 || parsedQty > 100) {
        return ctx.reply('⚠️ ကျေးဇူးပြု၍ မှန်ကန်သော အကြိမ်အရေအတွက် (Quantity) ကို 1 မှ 100 အတွင်း ဂဏန်းဖြင့်သာ ရိုက်ထည့်ပေးပါ (ဥပမာ- 5 သို့မဟုတ် 10):\n\n_သို့မဟုတ် /cancel ဖြင့် ဖျက်သိမ်းနိုင်ပါသည်။_');
      }
      ctx.session.quantity = parsedQty;
      ctx.session.step = 'CONFIRM_ORDER';
      return await showOrderConfirmation(ctx, topupNation);
    }

    if (ctx.session?.step === 'INPUT_EXTRA_INFO') {
      const requiredFields = ctx.session.requiredFields || [];
      const currentIndex = ctx.session.currentFieldIndex || 0;
      
      if (requiredFields.length === 0) return next();

      const currentField = requiredFields[currentIndex];
      
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
        await showOrderConfirmation(ctx, topupNation);
      }
      return;
    }

    if (userInput.includes('\n')) {
      return await handleBulkOrderFlow(ctx, userInput);
    }

    return next();
  });

  // Register all modular handlers
  registerTopupNationHandlers(bot, topupNation, (c: any) => showOrderConfirmation(c, topupNation), askNextRequiredField);
  registerG2BulkHandlers(bot, g2bulk, (c: any) => showOrderConfirmation(c, topupNation));
  registerBulkOrderHandlers(bot, topupNation, g2bulk, adminChatId, mainMenu, activeUserOrderLocks, processedOrderMessages);
  registerAccountHandlers(bot, adminChatId, mainMenu, (c: any) => renderOrderHistory(c, adminChatId), topupNation, g2bulk);
  registerOrderHandlers(bot, topupNation, g2bulk, adminChatId, mainMenu, activeUserOrderLocks, processedOrderMessages);

  // Initialize and Launch Bot
  if (options.isServerless && options.webhookUrl) {
    const webhookPath = `/api/bot-webhook-${botToken.split(':')[0]}`;
    bot.telegram.setWebhook(`${options.webhookUrl}${webhookPath}`).then(() => {
      console.log(`Telegram Bot Webhook set to ${options.webhookUrl}${webhookPath}`);
    }).catch(err => {
      console.error('Failed to set Telegram Bot Webhook:', err);
    });
  } else {
    // Polling mode with leadership lock
    const leaderLockId = uuidv4();
    const lockKey = 'telegram_bot_polling_leader';

    async function acquireLeaderLock(): Promise<boolean> {
      try {
        const now = new Date();
        const staleThreshold = new Date(now.getTime() - 25000);

        const lock = await BotLeaderLock.findOneAndUpdate(
          {
            lockKey,
            $or: [
              { instanceId: leaderLockId },
              { lastHeartbeat: { $lt: staleThreshold } }
            ]
          },
          {
            $set: {
              instanceId: leaderLockId,
              lastHeartbeat: now
            }
          },
          { upsert: true, returnDocument: 'after' }
        );

        return lock.instanceId === leaderLockId;
      } catch (err: any) {
        return false;
      }
    }

    let isPolling = false;

    setInterval(async () => {
      const isLeader = await acquireLeaderLock();
      if (isLeader && !isPolling) {
        console.log(`[Bot Leader] Instance ${leaderLockId} acquired polling leadership.`);
        isPolling = true;
        bot.launch({
          dropPendingUpdates: true
        }).then(() => {
          console.log('Telegram Bot successfully started via Polling mode');
        }).catch((err: any) => {
          console.error('Failed to start Telegram Bot in Polling mode:', err);
          isPolling = false;
        });
      } else if (!isLeader && isPolling) {
        console.log(`[Bot Leader] Instance ${leaderLockId} lost polling leadership. Stopping polling...`);
        isPolling = false;
        try { bot.stop('Lost leadership'); } catch (e) {}
      }
    }, 10000);

    acquireLeaderLock().then(isLeader => {
      if (isLeader && !isPolling) {
        isPolling = true;
        bot.launch({
          dropPendingUpdates: true
        }).then(() => {
          console.log('Telegram Bot successfully launched in polling mode.');
        }).catch((err: any) => {
          console.error('Failed to launch Telegram Bot:', err);
          isPolling = false;
        });
      }
    });
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}
