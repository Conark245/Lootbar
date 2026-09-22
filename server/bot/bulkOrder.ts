import { Telegraf, Markup } from 'telegraf';
import { MyContext } from './types';
import { BulkOrderService, BulkOrderItem } from '../bulkOrderService';
import { User } from '../models/User';
import { AppConfig } from '../models/AppConfig';
import { TopupNationService } from '../providers/topupnation/TopupNationService';
import { G2BulkService } from '../providers/g2bulk/G2BulkService';
import { getNotificationSettings } from '../notificationSettings';
import { 
  escapeMd, 
  escapeCode, 
  formatMyanmarDateTime, 
  safeReply, 
  safeSendMessage, 
  safeEditMessageText, 
  isProviderApiLinked 
} from './helpers';

// Helper to resolve current dynamic admin ID
async function getAdminChatId(defaultId: string | undefined): Promise<string | undefined> {
  try {
    const config = await AppConfig.findOne({ key: 'admin_chat_id' });
    return config?.value || defaultId;
  } catch { return defaultId; }
}

export async function handleBulkOrderFlow(
  ctx: MyContext,
  text: string
) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  // If user sent just "/bulk" or ".bulk" without order lines
  if (lines.length === 1 && (lines[0].toLowerCase() === '/bulk' || lines[0].toLowerCase() === '.bulk' || lines[0].toLowerCase() === 'bulk')) {
    return safeReply(
      ctx,
      `📦 *Bulk Top-Up Order (အော်ဒါအများအပြား တင်ခြင်း)*\n` +
      `═════════════════════════\n` +
      `အော်ဒါများစွာကို တစ်ကြိမ်တည်းဖြင့် တိုက်ရိုက်တင်ရန်အတွက် အောက်ပါအတိုင်း Message တစ်စောင်တည်းတွင် တစ်ကြောင်းချင်းစီ ရိုက်ပို့ပေးပါ:\n\n` +
      `📌 *Format:*\n` +
      `\`.<shortKey> <Account ID> [ZoneID] <Product> [xQty]\`\n\n` +
      `💡 *ဥပမာ နမူနာများ:*\n` +
      `\`.tp 123456789 100\`\n` +
      `\`.g2b 123456789 100\`\n` +
      `═════════════════════════\n` +
      `_💡 Note: အော်ဒါများကို မပို့မီ စုစုပေါင်းကုန်ကျငွေနှင့် အချက်အလက်များကို စနစ်မှ သေချာစွာ စစ်ဆေးအတည်ပြုခိုင်းမည် ဖြစ်ပါသည်။_`,
      Markup.inlineKeyboard([
        [Markup.button.callback('📜 View Bulk Order History', 'bulk_history_page_1')],
        [Markup.button.callback('🏠 Main Menu', 'main_menu')]
      ])
    );
  }

  try {
    const parseResult = await BulkOrderService.parseBulkText(text);

    if (parseResult.errors.length > 0) {
      let errMsg = `⚠️ *Bulk Order Format Errors!*\n═════════════════════════\n` +
        `အောက်ပါ စာကြောင်းများတွင် အချက်အလက် မပြည့်စုံပါ သို့မဟုတ် မှားယွင်းနေပါသည်:\n\n`;

      parseResult.errors.slice(0, 8).forEach(e => {
        errMsg += `❌ *Line ${e.lineIndex}:* \`${escapeCode(e.rawLine)}\`\n   ↳ _${escapeMd(e.error)}_\n\n`;
      });

      if (parseResult.errors.length > 8) {
        errMsg += `_... နောက်ထပ် error (${parseResult.errors.length - 8}) ခု ရှိပါသေးသည်။_\n\n`;
      }

      if (parseResult.validItems.length > 0) {
        errMsg += `✅ *မှန်ကန်သော အော်ဒါ:* ${parseResult.validItems.length} ခု\n` +
          `❌ *မှားယွင်းနေသော အော်ဒါ:* ${parseResult.errors.length} ခု\n\n` +
          `_ကျေးဇူးပြု၍ မှားယွင်းနေသော လိုင်းများကို ပြန်လည်စစ်ဆေးပြီး အားလုံးမှန်ကန်အောင် ပြန်လည်ပို့ပေးပါ။_`;
      } else {
        errMsg += `💡 *Format:* \`.ml 12345678 2001 wp\``;
      }

      return safeReply(ctx, errMsg);
    }

    if (parseResult.validItems.length === 0) {
      return safeReply(ctx, '⚠️ No valid order lines found in the message.');
    }

    // Check user balance
    let userDoc = await User.findOne({ telegramChatId: ctx.chat!.id });
    if (!userDoc) {
      userDoc = await User.create({
        telegramChatId: ctx.chat!.id,
        username: ctx.from?.username || (ctx.chat as any)?.username,
        firstName: ctx.from?.first_name || (ctx.chat as any)?.first_name,
        balance: 0
      });
    }

    const unlinkedTotalPrice = parseResult.validItems
      .filter(item => !isProviderApiLinked(userDoc, item.provider))
      .reduce((sum, item) => sum + item.totalPrice, 0);

    const isAllApiLinked = parseResult.validItems.every(item => isProviderApiLinked(userDoc, item.provider));
    const hasAnyApiLinked = parseResult.validItems.some(item => isProviderApiLinked(userDoc, item.provider));
    const userBalance = userDoc.balance || 0;
    const totalPrice = parseResult.totalPrice;

    if (unlinkedTotalPrice > userBalance) {
      const needed = (unlinkedTotalPrice - userBalance).toFixed(3);
      return safeReply(
        ctx,
        `⚠️ *Insufficient Balance for Bulk Order!*\n═════════════════════════\n` +
        `├── 📦 Total Orders: *${parseResult.validItems.length} items*\n` +
        `├── 💰 Wallet Required: \`$${unlinkedTotalPrice.toFixed(3)} USD\`\n` +
        `├── 💳 Your Balance: \`$${userBalance.toFixed(3)} USD\`\n` +
        `└── ⚠️ Needed More: \`$${needed} USD\`\n` +
        `═════════════════════════\n` +
        `_ကျေးဇူးပြု၍ Wallet ထဲသို့ ငွေဖြည့်သွင်းပြီးမှ အော်ဒါတင်ပေးပါ။_`,
        Markup.inlineKeyboard([
          [Markup.button.callback('💰 Request Top-Up', 'topup_flow_start')],
          [Markup.button.callback('❌ Cancel', 'cancel_order')]
        ])
      );
    }

    // Store in session
    ctx.session = ctx.session || {};
    ctx.session.bulkOrders = parseResult.validItems;
    ctx.session.bulkTotalPrice = totalPrice;
    ctx.session.bulkRawText = text;

    let summaryMsg = `🛒 *Confirm Bulk Top-Up Order*\n═════════════════════════\n` +
      `စုစုပေါင်း အော်ဒါ *(${parseResult.validItems.length})* ခု တင်ရန် အတည်ပြုပေးပါ:\n\n`;

    parseResult.validItems.forEach((item, idx) => {
      let accountStr = '';
      if (item.extraInfo) {
        const vals = Object.entries(item.extraInfo)
          .filter(([k, v]) => k !== 'paymentSource' && k !== 'provider' && v)
          .map(([_, v]) => String(v));
        accountStr = vals.join(' | ');
      }
      const qtyStr = item.quantity > 1 ? ` (x${item.quantity})` : '';
      summaryMsg += `▫️ *#${idx + 1} ${escapeMd(item.gameName)}* — ${escapeMd(item.skuName)}${qtyStr}\n` +
        `   └ 🎯 \`${escapeCode(accountStr)}\` • \`$${item.totalPrice.toFixed(3)}\`\n`;
    });

    summaryMsg += `═════════════════════════\n` +
      `├── 📦 Total Items: *${parseResult.validItems.length} orders* (${parseResult.totalQuantity} items)\n` +
      `├── 💰 Total Price: \`$${totalPrice.toFixed(3)} USD\`\n`;

    if (isAllApiLinked) {
      summaryMsg += `└── 💳 Payment: \`⚡ Direct API Balance Linked\`\n`;
    } else if (hasAnyApiLinked) {
      summaryMsg += `├── 💳 Payment: \`⚡ Mixed (Direct API + User Wallet)\`\n` +
        `├── 💰 Wallet Deduction: \`$${unlinkedTotalPrice.toFixed(3)} USD\`\n` +
        `└── 💵 Balance After: \`$${Math.max(0, userBalance - unlinkedTotalPrice).toFixed(3)} USD\`\n`;
    } else {
      const after = Math.max(0, userBalance - totalPrice);
      summaryMsg += `├── 💳 Current Balance: \`$${userBalance.toFixed(3)} USD\`\n` +
        `└── 💵 Balance After: \`$${after.toFixed(3)} USD\`\n`;
    }
    summaryMsg += `═════════════════════════`;

    const confirmKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`🚀 Confirm & Place ${parseResult.validItems.length} Orders ($${totalPrice.toFixed(3)})`, 'confirm_bulk_orders')],
      [Markup.button.callback('❌ Cancel Bulk Order', 'cancel_order')]
    ]);

    return safeReply(ctx, summaryMsg, confirmKeyboard);
  } catch (err: any) {
    console.error('Bulk order flow error:', err);
    return safeReply(ctx, `❌ Bulk Order Processing Error: ${err.message}`);
  }
}

export async function renderBulkOrderHistory(
  ctx: MyContext,
  adminChatId: string | undefined,
  isEdit: boolean = false,
  page: number = 1
) {
  const pageSize = 3;
  const chatId = ctx.chat!.id;
  const currentAdminId = await getAdminChatId(adminChatId);
  const isOwner = String(chatId) === currentAdminId;

  const data = await BulkOrderService.getBulkHistory({
    telegramChatId: isOwner ? undefined : chatId,
    page,
    limit: pageSize
  });

  const headerTitle = isOwner ? '👑 *Bulk Orders History (Admin View)*' : '📦 *My Bulk Order History*';

  if (data.total === 0) {
    const emptyMsg = `${headerTitle}\n═════════════════════════\n\n📜 _Bulk အော်ဒါမှတ်တမ်း မရှိသေးပါ။_\n\n/bulk ဖြင့် အော်ဒါများစွာ တစ်ခါတည်း စတင်ဝယ်ယူနိုင်ပါသည်!`;
    const emptyKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📦 Place Bulk Order', 'bulk_order_start')],
      [Markup.button.callback('📜 Single Orders History', 'view_orders_action')],
      [Markup.button.callback('🏠 Main Menu', 'main_menu')]
    ]);
    if (isEdit) return await safeEditMessageText(ctx, emptyMsg, emptyKeyboard);
    return await safeReply(ctx, emptyMsg, emptyKeyboard);
  }

  let msg = `${headerTitle}\n` +
    `📄 Page ${data.page} of ${data.totalPages} (Total: ${data.total} Batches)\n` +
    `═════════════════════════\n\n`;

  const detailButtons: any[] = [];

  data.batches.forEach((b: any, idx: number) => {
    const batchNum = (data.page - 1) * pageSize + idx + 1;
    const timeStr = formatMyanmarDateTime(b.createdAt);
    const userStr = isOwner && b.telegramChatId ? ` (${b.telegramUsername ? `@${b.telegramUsername}` : `ID:${b.telegramChatId}`})` : '';

    msg += `📦 *#${batchNum} Batch: \`${b.batchId}\`*${userStr}\n` +
      `├── 🕒 Time: \`${timeStr}\`\n` +
      `├── 📊 Requested: *${b.totalRequested} orders*\n` +
      `├── ✅ Success: *${b.successCount}* | ❌ Failed: *${b.failedCount}*\n` +
      `├── 💰 Total Spent: \`$${Number(b.totalSpent || 0).toFixed(3)} USD\`\n` +
      `└── 💳 Payment: \`${b.isApiLinked ? '⚡ Direct API' : '💰 User Wallet'}\`\n\n`;

    detailButtons.push([
      Markup.button.callback(`🔍 View Batch #${batchNum} (\`${b.batchId}\`)`, `bulk_batch_detail_${b.batchId}`)
    ]);
  });

  msg += `═════════════════════════\n` +
    `_💡 အသေးစိတ်ကြည့်လိုပါက သက်ဆိုင်ရာ Batch Button ကို နှိပ်ပါ_`;

  const navRow: any[] = [];
  if (data.page > 1) {
    navRow.push(Markup.button.callback('◀️ Prev', `bulk_history_page_${data.page - 1}`));
  }
  navRow.push(Markup.button.callback(`📄 ${data.page}/${data.totalPages}`, 'noop_page_indicator'));
  if (data.page < data.totalPages) {
    navRow.push(Markup.button.callback('Next ▶️', `bulk_history_page_${data.page + 1}`));
  }

  const allButtons = [
    ...detailButtons,
    ...(navRow.length > 0 ? [navRow] : []),
    [
      Markup.button.callback('🔄 Refresh', `bulk_history_page_${data.page}`),
      Markup.button.callback('📜 Single Orders', 'view_orders_action')
    ],
    [Markup.button.callback('🏠 Main Menu', 'main_menu')]
  ];

  const keyboard = Markup.inlineKeyboard(allButtons);
  if (isEdit) return await safeEditMessageText(ctx, msg, keyboard);
  return await safeReply(ctx, msg, keyboard);
}

export async function renderBulkBatchDetail(ctx: MyContext, batchId: string) {
  const batch = await BulkOrderService.getBulkBatchById(batchId);
  if (!batch) {
    return safeReply(ctx, '❌ Bulk batch details not found.');
  }

  let msg = `📦 *Bulk Batch Details: \`${batch.batchId}\`*\n` +
    `═════════════════════════\n` +
    `├── 🕒 Created: \`${formatMyanmarDateTime(batch.createdAt)}\`\n` +
    `├── 👤 User: \`${batch.telegramChatId}\` (${escapeMd(batch.telegramUsername ? `@${batch.telegramUsername}` : batch.telegramFirstName || 'User')})\n` +
    `├── 📊 Total Requested: *${batch.totalRequested} orders*\n` +
    `├── ✅ Successful: *${batch.successCount}*\n` +
    `├── ❌ Failed: *${batch.failedCount}*\n` +
    `├── 💰 Total Spent: \`$${Number(batch.totalSpent || 0).toFixed(3)} USD\`\n` +
    `└── 💳 Source: \`${(batch.source || 'BOT').toUpperCase()}\` (${batch.isApiLinked ? '⚡ Direct API' : '💰 User Wallet'})\n` +
    `═════════════════════════\n\n*Order Lines Breakdown:*\n`;

  (batch.results || []).slice(0, 15).forEach((r: any, idx: number) => {
    const qtyStr = r.quantity > 1 ? ` (x${r.quantity})` : '';
    if (r.success) {
      msg += `✅ *#${idx + 1} ${escapeMd(r.gameName)}* — ${escapeMd(r.skuName)}${qtyStr}\n` +
        `   └ 🆔 \`${r.orderId || r.referenceId}\` • \`$${Number(r.price || 0).toFixed(3)}\` • _${r.statusText || 'PROCESSING'}_\n`;
    } else {
      msg += `❌ *#${idx + 1} ${escapeMd(r.gameName)}* — ${escapeMd(r.skuName)}${qtyStr}\n` +
        `   └ ⚠️ Error: _${escapeMd(r.error || 'Failed')}_\n`;
    }
  });

  if ((batch.results || []).length > 15) {
    msg += `_... နောက်ထပ် အော်ဒါ (${batch.results.length - 15}) ခု ကျန်ပါသေးသည်။_\n`;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Back to Bulk History', 'bulk_history_page_1')],
    [Markup.button.callback('🏠 Main Menu', 'main_menu')]
  ]);

  return await safeReply(ctx, msg, keyboard);
}

export function registerBulkOrderHandlers(
  bot: Telegraf<MyContext>,
  topupNation: TopupNationService | undefined,
  g2bulk: G2BulkService | undefined,
  adminChatId: string | undefined,
  mainMenu: any,
  activeUserOrderLocks: Map<number | string, number>,
  processedOrderMessages: Set<string>
) {
  // Bulk Command Handler (/bulk or /bulkorder)
  bot.command(['bulk', 'bulkorder'], async (ctx) => {
    const text = ctx.message.text || '';
    return await handleBulkOrderFlow(ctx, text);
  });

  bot.hears(['📦 Bulk Order', 'Bulk Order', 'bulk order', 'Bulk order'], async (ctx) => {
    return await handleBulkOrderFlow(ctx, '/bulk');
  });

  bot.hears(['📦 Bulk History', 'Bulk History', 'bulk history', 'Bulk history', 'Bulk Order History', '📦 Bulk Order History'], async (ctx) => {
    return await renderBulkOrderHistory(ctx, adminChatId);
  });

  bot.command(['bulkhistory', 'bulkorders', 'bulkhist', 'bulk_history', 'bulk_orders'], async (ctx) => {
    return await renderBulkOrderHistory(ctx, adminChatId);
  });

  bot.action(/^bulk_history_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10) || 1;
    await ctx.answerCbQuery();
    return await renderBulkOrderHistory(ctx, adminChatId, true, page);
  });

  bot.action(/^bulk_batch_detail_(.+)$/, async (ctx) => {
    const batchId = ctx.match[1];
    await ctx.answerCbQuery();
    return await renderBulkBatchDetail(ctx, batchId);
  });

  bot.action('bulk_order_start', async (ctx) => {
    await ctx.answerCbQuery();
    return await handleBulkOrderFlow(ctx, '/bulk');
  });

  // Action: Confirm Bulk Orders Execution
  bot.action('confirm_bulk_orders', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // 1. SYNCHRONOUS IN-MEMORY MUTEX LOCK
    const now = Date.now();
    const lastLock = activeUserOrderLocks.get(chatId);
    if (lastLock && now - lastLock < 60000) {
      return await ctx.answerCbQuery('⚠️ Bulk order is already being processed! Please wait...', { show_alert: true });
    }
    activeUserOrderLocks.set(chatId, now);

    // 2. MESSAGE-LEVEL DEDUPLICATION
    const messageId = ctx.callbackQuery?.message?.message_id;
    const messageKey = messageId ? `bulk_${chatId}_${messageId}` : undefined;
    if (messageKey) {
      if (processedOrderMessages.has(messageKey)) {
        activeUserOrderLocks.delete(chatId);
        return await ctx.answerCbQuery('⚠️ This bulk order was already submitted!', { show_alert: true });
      }
      processedOrderMessages.add(messageKey);
      if (processedOrderMessages.size > 5000) {
        const toRemove = Array.from(processedOrderMessages).slice(0, 1000);
        toRemove.forEach(k => processedOrderMessages.delete(k));
      }
    }

    const bulkItems: BulkOrderItem[] = ctx.session?.bulkOrders || [];
    if (!bulkItems || bulkItems.length === 0) {
      activeUserOrderLocks.delete(chatId);
      return await ctx.answerCbQuery('⚠️ Bulk order already processed or expired!', { show_alert: true });
    }

    // 3. Fire and forget markup removal
    ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    await ctx.answerCbQuery('Processing bulk order...');

    try {
      const userDoc = await User.findOne({ telegramChatId: ctx.chat!.id });
      if (!userDoc) return safeReply(ctx, '❌ User account not found.', mainMenu);

      const itemsToRun = [...bulkItems];
      ctx.session.bulkOrders = [];
      ctx.session.bulkTotalPrice = 0;

      const progressMsg = await ctx.reply(
        `⏳ *Processing Bulk Order...*\n═════════════════════════\n` +
        `အော်ဒါ ${itemsToRun.length} ခုအား တစ်ခုချင်းစီ ဆာဗာသို့ ပေးပို့ဆောင်ရွက်နေပါသည်...\n` +
        `_ကျေးဇူးပြု၍ ခေတ္တစောင့်ဆိုင်းပေးပါ..._`,
        { parse_mode: 'Markdown' }
      );

      const rawText = ctx.session?.bulkRawText;
      const summary = await BulkOrderService.executeBulkOrders(
        userDoc,
        itemsToRun,
        topupNation,
        g2bulk,
        { rawText, source: 'bot' }
      );

      let finalMsg = `📦 *Bulk Top-Up Order Report*\n═════════════════════════\n` +
        `├── 🆔 Batch ID: \`${summary.batchId}\`\n` +
        `├── 📊 Total Requested: *${summary.totalRequested} orders*\n` +
        `├── ✅ Successful: *${summary.successCount}*\n` +
        `├── ❌ Failed: *${summary.failedCount}*\n` +
        `├── 💰 Total Spent: \`$${summary.totalSpent.toFixed(3)} USD\`\n`;

      if (!summary.isApiLinked) {
        finalMsg += `└── 💳 Remaining Balance: \`$${summary.userBalanceAfter.toFixed(3)} USD\`\n`;
      } else {
        finalMsg += `└── 💳 Payment: \`⚡ Direct API Balance Linked\`\n`;
      }
      finalMsg += `═════════════════════════\n\n*Detailed Order Results:*\n`;

      summary.results.slice(0, 12).forEach((r, idx) => {
        const qtyStr = r.quantity > 1 ? ` (x${r.quantity})` : '';
        if (r.success) {
          finalMsg += `✅ *#${idx + 1} ${escapeMd(r.gameName)}* — ${escapeMd(r.skuName)}${qtyStr}\n` +
            `   └ 🆔 \`${r.orderId || r.referenceId}\` • \`$${r.price.toFixed(3)}\` • _${r.statusText || 'PROCESSING'}_\n`;
        } else {
          finalMsg += `❌ *#${idx + 1} ${escapeMd(r.gameName)}* — ${escapeMd(r.skuName)}${qtyStr}\n` +
            `   └ ⚠️ Error: _${escapeMd(r.error || 'Failed')}_\n`;
        }
      });

      if (summary.results.length > 12) {
        finalMsg += `_... နောက်ထပ် အော်ဒါ (${summary.results.length - 12}) ခု ပြီးဆုံးပါပြီ။_\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📜 Bulk History', 'bulk_history_page_1'),
          Markup.button.callback('📑 All Orders', 'view_orders_action')
        ],
        [Markup.button.callback('🏠 Main Menu', 'main_menu')]
      ]);

      if (progressMsg) {
        try {
          await ctx.deleteMessage(progressMsg.message_id);
        } catch {}
      }

      await safeReply(ctx, finalMsg, keyboard);

      // Notify Owner/Admin
      const currentAdminIdForNotify = await getAdminChatId(adminChatId);
      const notiSettings = await getNotificationSettings();
      if (currentAdminIdForNotify && notiSettings.adminOrderAlerts) {
        const fromUser = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'User';
        const adminBulkNotify = `🔔 *New Bulk Top-Up Order!*\n` +
          `═════════════════════════\n` +
          `├── 👤 User: \`${ctx.chat!.id}\` (${escapeMd(fromUser)})\n` +
          `├── 📦 Total Orders: *${summary.totalRequested}*\n` +
          `├── ✅ Success: *${summary.successCount}* | ❌ Failed: *${summary.failedCount}*\n` +
          `├── 💰 Total Spent: \`$${summary.totalSpent.toFixed(3)} USD\`\n` +
          `└── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\`\n` +
          `═════════════════════════`;
        await safeSendMessage(bot.telegram, currentAdminIdForNotify, adminBulkNotify);
      }
    } catch (err: any) {
      console.error('Bulk order execution error:', err);
      return safeReply(ctx, `❌ Bulk Order Execution Error: ${err.message}`, mainMenu);
    } finally {
      activeUserOrderLocks.delete(chatId);
    }
  });
}
