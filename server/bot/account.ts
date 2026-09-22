import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { MyContext } from './types';
import { User } from '../models/User';
import { TopupRequest } from '../models/TopupRequest';
import { AppConfig } from '../models/AppConfig';
import { TopupNationService } from '../providers/topupnation/TopupNationService';
import { G2BulkService } from '../providers/g2bulk/G2BulkService';
import { getTopupNationLiveBalance } from './topupnation';
import { getG2BulkLiveBalance } from './g2bulk';
import { 
  escapeMd, 
  escapeCode, 
  formatMyanmarDateTime, 
  safeReply, 
  safeSendMessage, 
  safeEditMessageText, 
  safeSendPhoto, 
  safeEditMessageCaption 
} from './helpers';

async function getAdminChatId(defaultId: string | undefined): Promise<string | undefined> {
  try {
    const config = await AppConfig.findOne({ key: 'admin_chat_id' });
    return config?.value || defaultId;
  } catch { return defaultId; }
}

export async function renderAccountProfile(ctx: MyContext, isEdit: boolean = false, renderOrderHistory?: (ctx: MyContext) => Promise<any>) {
  const user = await User.findOne({ telegramChatId: ctx.chat!.id });
  
  let msg = `👤 *Your Profile*\n` +
    `═════════════════════════\n` +
    `📛 *Name:* \`${user?.firstName || 'User'}\`\n` +
    `🆔 *ID:* \`${user?.telegramChatId}\`\n` +
    `💰 *Wallet Balance:* \`$${Number(user?.balance || 0).toFixed(3)} USD\`\n` +
    `═════════════════════════\n`;

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

let balanceCache: { tpn?: any; g2b?: any; lastFetched: number } = { lastFetched: 0 };

export async function renderBalance(
  ctx: MyContext, 
  isEdit: boolean = false,
  topupNation?: TopupNationService,
  g2bulk?: G2BulkService,
  forceRefresh: boolean = false
) {
  const user = await User.findOne({ telegramChatId: ctx.chat!.id });
  const now = Date.now();
  
  if (forceRefresh || now - balanceCache.lastFetched > 10000 || !balanceCache.tpn) {
    const [tpnRes, g2bRes] = await Promise.all([
      getTopupNationLiveBalance(topupNation).catch(() => ({ success: false, balance: '0.00', currency: 'USD' })),
      getG2BulkLiveBalance(g2bulk).catch(() => ({ success: false, balance: '0.00', currency: 'USD' }))
    ]);
    balanceCache = { tpn: tpnRes, g2b: g2bRes, lastFetched: now };
  }

  const tpnBalStr = balanceCache.tpn?.success ? `$${balanceCache.tpn.balance} USD` : 'Offline / Unconfigured';
  const g2bBalStr = balanceCache.g2b?.success ? `$${balanceCache.g2b.balance} USD` : 'Offline / Unconfigured';
  const isApiLinked = !!(user?.useDirectApiBalance || user?.balanceMode === 'api');

  let msg = `💳 *Your Wallet & Live API Balances*\n` +
    `═════════════════════════\n` +
    `💰 *Wallet Balance:* \`$${Number(user?.balance || 0).toFixed(3)} USD\`\n` +
    `⚡ *Account Tier:* \`${isApiLinked ? 'Direct API Linked (VIP)' : 'Pre-funded Wallet Balance'}\`\n\n` +
    `⚡ *Provider Live API Balances:*\n` +
    `├── 🌐 *TopupNation:* \`${tpnBalStr}\`\n` +
    `└── 🔥 *G2Bulk:* \`${g2bBalStr}\`\n` +
    `═════════════════════════\n` +
    `_💡 သင့် Wallet ထဲသို့ ငွေဖြည့်သွင်းလိုပါက အောက်ပါ Request Balance Top-Up ခလုတ်ကို နှိပ်ပါ:_`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Request Balance Top-Up', 'topup_flow_start'),
      Markup.button.callback('🔄 Refresh Balances', 'refresh_my_balance')
    ],
    [
      Markup.button.callback('👤 My Profile', 'view_my_profile'),
      Markup.button.callback('📜 Order History', 'view_my_orders')
    ]
  ]);

  if (isEdit) {
    return await safeEditMessageText(ctx, msg, keyboard);
  } else {
    return await safeReply(ctx, msg, keyboard);
  }
}

export async function startTopupRequest(ctx: MyContext) {
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
    intro += `💳 *Current Wallet Balance:* \`$${Number(user.balance || 0).toFixed(3)} USD\`\n\n`;
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

export async function submitTopupRequest(
  bot: Telegraf<MyContext>,
  ctx: MyContext,
  amount: number,
  adminChatId: string | undefined,
  mainMenu: any,
  note: string = '',
  photoFileId?: string
) {
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

  const userConfirmMsg = `✅ *Top-Up Request Submitted!*\n` +
    `═════════════════════════\n` +
    `├── 🆔 Request ID: \`${requestId}\`\n` +
    `├── 💰 Requested Amount: \`$${amount.toFixed(3)} USD\`\n` +
    `├── 📸 Payment Slip: \`Attached ✅\`\n` +
    (note ? `├── 📝 Note / Ref: \`${escapeCode(note)}\`\n` : '') +
    `├── 💳 Current Balance: \`$${Number(user.balance || 0).toFixed(3)} USD\`\n` +
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
    `├── 💵 Requested Amount: \`$${amount.toFixed(3)} USD\`\n` +
    `├── 💳 Current Balance: \`$${Number(user.balance || 0).toFixed(3)} USD\`\n` +
    `├── 📝 Note / Ref: \`${safeNote}\`\n` +
    `└── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\`\n` +
    `═════════════════════════\n` +
    `အောက်ပါ ခလုတ်များကို နှိပ်၍ အတည်ပြု/ပယ်ဖျက်နိုင်ပါသည်:`;

  const adminKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(`✅ Approve (+$${amount.toFixed(3)})`, `topup_approve_${requestId}`),
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

export function registerAccountHandlers(
  bot: Telegraf<MyContext>,
  adminChatId: string | undefined,
  mainMenu: any,
  renderOrderHistory?: (ctx: MyContext) => Promise<any>,
  topupNation?: TopupNationService,
  g2bulk?: G2BulkService
) {
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
    const user = await User.findOneAndUpdate({ telegramChatId: Number(targetId) }, { $inc: { balance: amount } }, { returnDocument: 'after', upsert: true });
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

    const updatedUser = await User.findOneAndUpdate(
      { telegramChatId: topupReq.telegramChatId },
      { $inc: { balance: topupReq.amount } },
      { returnDocument: 'after' }
    );

    await ctx.answerCbQuery('✅ Top-up approved & balance added!');
    
    const approvedMsg = `✅ *Top-Up Request Approved!*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 👤 User: \`${topupReq.telegramChatId}\`\n` +
      `├── 💵 Amount Added: \`+$${topupReq.amount.toFixed(3)} USD\`\n` +
      `├── 💳 User New Balance: \`$${Number(updatedUser?.balance || 0).toFixed(3)} USD\`\n` +
      `├── 👤 Approved by: \`Admin / Owner\`\n` +
      `└── 📅 Time: \`${new Date().toLocaleTimeString()}\`\n` +
      `═════════════════════════`;

    await safeEditMessageCaption(ctx, approvedMsg);

    const userSuccessMsg = `🎉 *Balance Top-Up Approved!*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 💰 Added Amount: \`+$${topupReq.amount.toFixed(3)} USD\`\n` +
      `├── 💳 New Wallet Balance: \`$${Number(updatedUser?.balance || 0).toFixed(3)} USD\`\n` +
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
      `├── 💵 Amount: \`$${topupReq.amount.toFixed(3)} USD\`\n` +
      `├── 👤 Declined by: \`Admin / Owner\`\n` +
      `└── 📅 Time: \`${new Date().toLocaleTimeString()}\`\n` +
      `═════════════════════════`;

    await safeEditMessageCaption(ctx, rejectedMsg);

    const userRejectMsg = `❌ *Top-Up Request Declined*\n` +
      `═════════════════════════\n` +
      `├── 🆔 Request ID: \`${requestId}\`\n` +
      `├── 💰 Amount: \`$${topupReq.amount.toFixed(3)} USD\`\n` +
      `└── ❌ Status: *DECLINED*\n` +
      `═════════════════════════\n` +
      `Admin မှ ငွေဖြည့်သွင်းမှုအား ပယ်ဖျက်လိုက်ပါသည်။ အသေးစိတ်သိရှိလိုပါက Admin သို့ ဆက်သွယ်ပါ။`;

    await safeSendMessage(bot.telegram, topupReq.telegramChatId, userRejectMsg, mainMenu);
  });

  bot.action('view_my_balance', async (ctx) => {
    await ctx.answerCbQuery();
    return await renderBalance(ctx, true, topupNation, g2bulk);
  });

  bot.action('refresh_my_balance', async (ctx) => {
    await ctx.answerCbQuery('🔄 Refreshing live API balances...');
    return await renderBalance(ctx, true, topupNation, g2bulk, true);
  });

  bot.action('view_my_profile', async (ctx) => {
    await ctx.answerCbQuery();
    return await renderAccountProfile(ctx, true, renderOrderHistory);
  });

  bot.action('view_my_orders', async (ctx) => {
    await ctx.answerCbQuery();
    if (renderOrderHistory) {
      return await renderOrderHistory(ctx);
    }
  });

  bot.hears([
    '👤 My Account', 'My Account', 'Account', 'account', '👤 Profile', 'Profile', 'profile', '👤 My Profile'
  ], async (ctx) => {
    return await renderAccountProfile(ctx, false, renderOrderHistory);
  });

  bot.command(['account', 'profile', 'myaccount', 'myprofile'], async (ctx) => {
    return await renderAccountProfile(ctx, false, renderOrderHistory);
  });

  bot.hears([
    '💳 Check Balance', '💳 My Balance', 'My Balance', 'Balance', 'balance', 
    'Wallet', 'wallet', '💳 Wallet', '💰 Balance', 'API Balance', 'api balance', 
    'API Balance စစ်မည်', 'လက်ကျန်ငွေ', 'လက်ကျန်ငွေ စစ်မည်'
  ], async (ctx) => {
    return await renderBalance(ctx, false, topupNation, g2bulk);
  });

  bot.command([
    'balance', 'wallet', 'mybalance', 'mywallet', 'checkbalance',
    'apibalance', 'apibal', 'apis', 'api', 'adminbalance',
    'tpnbalance', 'topupnationbalance', 'g2bbalance', 'g2bulkbalance'
  ], async (ctx) => {
    return await renderBalance(ctx, false, topupNation, g2bulk);
  });

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

    await ctx.answerCbQuery(`Selected $${amount.toFixed(3)} USD`);

    const promptMsg = `💰 *Selected Top-Up Amount:* \`$${amount.toFixed(3)} USD\`\n\n` +
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
}
