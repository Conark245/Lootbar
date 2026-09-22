import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { MyContext } from './types';
import { User } from '../models/User';
import { Order } from '../models/Order';
import { Session } from '../models/Session';
import { OrderLock } from '../models/OrderLock';
import { AppConfig } from '../models/AppConfig';
import { LootBarClient } from '../providers/lootbar/LootBarClient';
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

async function getAdminChatId(defaultId: string | undefined): Promise<string | undefined> {
  try {
    const config = await AppConfig.findOne({ key: 'admin_chat_id' });
    return config?.value || defaultId;
  } catch { return defaultId; }
}

function isValidValue(val: any): boolean {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  if (!s || s === '' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null' || s === '[object Object]') {
    return false;
  }
  return true;
}

export function formatOrderTreeNode(o: any, orderNumber: number, showUserInfo: boolean = false): string {
  const isTopupNation = o.provider === 'topupnation' || o.extraInfo?.provider === 'topupnation';
  const isG2Bulk = o.provider === 'g2bulk' || o.extraInfo?.provider === 'g2bulk';
  const providerBadge = isG2Bulk ? '🔥 G2Bulk API' : isTopupNation ? '⚡ TopupNation API' : '🎮 LootBar API';
  const safeGame = escapeMd(o.gameName || 'Game');
  const safeSku = escapeMd(o.skuName || `Product #${o.skuId}`);
  const priceVal = `$${Number(o.price || 0).toFixed(3)}`;

  const stateMap: Record<number, { statusText: string; icon: string; message: string }> = {
    0: { statusText: 'PENDING', icon: '⏳', message: 'Order created, awaiting transaction' },
    1: { statusText: 'PROCESSING', icon: '🔄', message: `${providerBadge} delivering top-up` },
    2: { statusText: 'COMPLETED', icon: '✅', message: 'Order completed successfully' },
    3: { statusText: 'FAILED', icon: '❌', message: 'Order failed on game server (Refunded)' },
    4: { statusText: 'SETTLING', icon: '⚡', message: 'Transaction in settlement stage' },
    5: { statusText: 'PARTIAL', icon: '⚠️', message: 'Order partially fulfilled' },
    6: { statusText: 'CANCELLED', icon: '🚫', message: 'Order was cancelled' }
  };

  const status = stateMap[o.state] || { statusText: 'PROCESSING', icon: '⏳', message: `${providerBadge} processing` };

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

export async function renderOrderHistory(
  ctx: MyContext, 
  adminChatId: string | undefined,
  isEdit: boolean = false, 
  page: number = 1, 
  providerFilter: 'all' | 'lootbar' | 'topupnation' = 'all',
  scope?: 'all' | 'mine'
) {
  const pageSize = 3;
  const chatId = ctx.chat!.id;
  const currentAdminId = await getAdminChatId(adminChatId);
  const isOwner = String(chatId) === currentAdminId;

  const actualScope: 'all' | 'mine' = isOwner ? (scope || 'all') : 'mine';
  const isAllUsersView = isOwner && actualScope === 'all';

  const userQuery: any = isAllUsersView ? {} : { telegramChatId: chatId };

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

  buttonRows.push([
    Markup.button.callback(`${providerFilter === 'all' ? '🔘' : '🌐'} All (${totalAll})`, `order_filter_all_${actualScope}_page_1`),
    Markup.button.callback(`${providerFilter === 'lootbar' ? '🔘' : '🎮'} LootBar (${totalLootBar})`, `order_filter_lootbar_${actualScope}_page_1`),
    Markup.button.callback(`${providerFilter === 'topupnation' ? '🔘' : '⚡'} TopupNation (${totalTopupNation})`, `order_filter_topupnation_${actualScope}_page_1`)
  ]);

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

export async function showOrderConfirmation(
  ctx: MyContext, 
  lootbar: LootBarClient, 
  topupNation?: TopupNationService,
  editMessage: boolean = false
) {
  ctx.session.step = 'CONFIRM_ORDER';
  const userDoc = await User.findOne({ telegramChatId: ctx.chat!.id });
  const currentProvider = ctx.session.provider || 'lootbar';
  const isApiLinked = isProviderApiLinked(userDoc, currentProvider);
  const userBalance = userDoc?.balance || 0;
  
  const gameId = ctx.session.gameId;
  const gameName = ctx.session.gameName || 'Game';
  const skuName = ctx.session.skuName || 'Product';
  const quantity = Math.max(1, Math.min(100, ctx.session.quantity || 1));
  ctx.session.quantity = quantity;
  const unitPrice = ctx.session.skuPrice || 0;
  const price = unitPrice * quantity;
  let playerName = ctx.session.playerName;
  const extraInfo = ctx.session.extraInfo || {};

  // Optional: Try to resolve player name in background
  if (!playerName && gameId && Object.keys(extraInfo).length > 0) {
    try {
      let checkResult;
      if (ctx.session.provider === 'topupnation' && topupNation) {
        checkResult = await topupNation.checkRole(gameId, extraInfo);
      } else if (ctx.session.provider === 'lootbar') {
        checkResult = await lootbar.checkRole(gameId, extraInfo);
      }
      
      if (checkResult?.playerName) {
        playerName = checkResult.playerName;
        ctx.session.playerName = checkResult.playerName;
      }
    } catch (err) {}
  }

  const chatId = ctx.chat?.id;
  const provider = ctx.session.provider || 'ORD';
  const idempotencyKey = `BOT-${provider.toUpperCase()}-${chatId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  ctx.session.orderIdempotencyKey = idempotencyKey;

  let playerId = '';
  let serverId = '';
  const otherDetails: { key: string; val: string }[] = [];

  for (const [rawKey, rawVal] of Object.entries(extraInfo)) {
    if (!isValidValue(rawVal)) continue;
    const key = String(rawKey || '').trim();
    const val = String(rawVal).trim();
    const lk = key.toLowerCase();
    if (!key || lk === 'undefined' || lk === 'null' || lk === 'paymentsource' || lk === 'provider') continue;
    if (!playerId && (lk === 'uid' || lk === 'userid' || lk === 'user_id' || lk === 'player_id' || lk === 'account_id' || lk === 'useraccount')) {
      playerId = val;
    } else if (!serverId && (lk === 'zoneid' || lk === 'zone_id' || lk === 'server' || lk === 'server_id' || lk === 'serverid')) {
      serverId = val;
    } else if (!playerName && (lk === 'player_name' || lk === 'role_name' || lk === 'nickname' || lk === 'playername' || lk === 'role')) {
      playerName = val;
    } else {
      otherDetails.push({ key: key.toUpperCase(), val });
    }
  }

  const balanceAfter = userBalance - price;

  const failKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Top Up Balance', 'topup_flow_start')],
    [Markup.button.callback('❌ Cancel', 'cancel_order')]
  ]);

  if (!isApiLinked && userBalance < price) {
    const needed = (price - userBalance).toFixed(3);
    let failMsg = `⚠️ *Insufficient Balance!*\n═════════════════════════\n` +
      `├── 🎮 Game: *${escapeMd(gameName)}*\n` +
      `├── 📦 Package: *${escapeMd(skuName)}*\n`;
    if (quantity > 1) {
      failMsg += `├── 🔢 Quantity: *${quantity}x*\n`;
    }
    failMsg += `├── 💰 Required: \`$${price.toFixed(3)}\`\n` +
      `└── 💳 Your Balance: \`$${userBalance.toFixed(3)}\`\n` +
      `═════════════════════════\n` +
      `_You need $${needed} USD more to place this order._`;

    if (editMessage) {
      try {
        return await ctx.editMessageText(failMsg, { parse_mode: 'Markdown', ...failKeyboard });
      } catch {}
    }
    return ctx.reply(failMsg, {
      parse_mode: 'Markdown',
      ...failKeyboard
    });
  }

  const lines: string[] = [];
  lines.push(`🛒 *Confirm Top-Up Order*`);
  lines.push(`═════════════════════════`);
  lines.push(`├── 🎮 Game: *${escapeMd(gameName)}*`);
  lines.push(`├── 📦 Package: *${escapeMd(skuName)}*`);
  if (quantity > 1) {
    lines.push(`├── 🔢 Quantity: *${quantity}x*`);
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
  if (quantity > 1) {
    lines.push(`├── 🏷 Unit Price: \`$${unitPrice.toFixed(3)}\``);
    lines.push(`├── 💰 Total Price: \`$${price.toFixed(3)}\``);
  } else {
    lines.push(`├── 💰 Price: \`$${price.toFixed(3)}\``);
  }
  if (isApiLinked) {
    lines.push(`└── 💳 Payment: \`⚡ Direct API Balance Linked\``);
  } else {
    lines.push(`├── 💳 Payment: \`Wallet Balance ($${userBalance.toFixed(3)})\``);
    lines.push(`└── 💵 Remaining After: \`$${balanceAfter.toFixed(3)}\``);
  }
  lines.push(`═════════════════════════`);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(`✅ Confirm & Pay ($${price.toFixed(3)})`, 'confirm_place_order')],
    [Markup.button.callback('❌ Cancel Order', 'cancel_order')]
  ]);

  if (editMessage) {
    try {
      return await ctx.editMessageText(lines.join('\n'), {
        parse_mode: 'Markdown',
        ...keyboard
      });
    } catch {}
  }

  return ctx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

export async function finalizeOrder(
  bot: Telegraf<MyContext>,
  ctx: MyContext,
  lootbar: LootBarClient,
  topupNation: TopupNationService | undefined,
  g2bulk: G2BulkService | undefined,
  adminChatId: string | undefined,
  mainMenu: any
) {
  const isTopupNation = ctx.session.provider === 'topupnation';
  const isG2Bulk = ctx.session.provider === 'g2bulk';
  const providerName = isG2Bulk ? 'G2Bulk' : isTopupNation ? 'TopupNation' : 'LootBar';
  
  const referenceId = uuidv4().replace(/-/g, '').substring(0, 32);
  const idempotencyKey = ctx.session.orderIdempotencyKey || `BOT-${(ctx.session.provider || 'ORD').toUpperCase()}-${referenceId}`;
  const gameId = ctx.session.gameId!;
  const skuId = ctx.session.skuId!;
  const gameName = ctx.session.gameName || 'Game';
  const skuName = ctx.session.skuName || 'Product';
  const quantity = ctx.session.quantity || 1;
  let playerName = ctx.session.playerName || undefined;
  const extraInfo = ctx.session.extraInfo || {};
  let orderCost = (ctx.session.skuPrice || 1) * quantity;

  ctx.session.step = 'DONE';
  ctx.session.gameId = undefined;
  ctx.session.skuId = undefined;
  ctx.session.extraInfo = undefined;
  ctx.session.orderIdempotencyKey = undefined;

  const thirtySecsAgo = new Date(Date.now() - 30 * 1000);
  const existingRecentOrder = await Order.findOne({
    telegramChatId: ctx.chat!.id,
    gameId,
    skuId,
    createdAt: { $gte: thirtySecsAgo }
  });

  if (existingRecentOrder) {
    console.warn(`[Duplicate Guard] Prevented twin order for chat ${ctx.chat!.id}.`);
    const safeGame = escapeMd(gameName);
    const safeSku = escapeMd(skuName);
    const existingOrderId = existingRecentOrder.providerOrderId || existingRecentOrder.orderId;
    return await ctx.reply(
      `⚠️ *Duplicate Order Prevented!*\n` +
      `═════════════════════════\n` +
      `အော်ဒါနှစ်ခါ မကျစေရန် စနစ်မှ အလိုအလျောက် တားဆီးပေးထားပါသည်:\n` +
      `├── 🎮 Game: *${safeGame}*\n` +
      `├── 📦 Package: *${safeSku}*\n` +
      `└── 🆔 Existing Order ID: \`${existingOrderId}\`\n` +
      `═════════════════════════\n` +
      `_တူညီသောအော်ဒါကို လွန်ခဲ့သော စက္ကန့်အနည်းငယ်က တင်ပြီးဖြစ်သောကြောင့် ထပ်မံဖြတ်တောက်ခြင်း မပြုလုပ်တော့ပါ။_`,
      { parse_mode: 'Markdown' }
    );
  }

  await ctx.reply(`⏳ Processing your top-up order with ${providerName} API, please wait...`);
  
  const userDoc = await User.findOne({ telegramChatId: ctx.chat!.id });
  if (!userDoc) {
    return ctx.reply('❌ User account not found.');
  }

  const currentTelegramUsername = ctx.from?.username || (ctx.chat as any)?.username || userDoc.username || undefined;
  const currentTelegramFirstName = ctx.from?.first_name || (ctx.chat as any)?.first_name || userDoc.firstName || undefined;
  const currentTelegramLastName = ctx.from?.last_name || (ctx.chat as any)?.last_name || undefined;
  
  const currentProvider = isG2Bulk ? 'g2bulk' : isTopupNation ? 'topupnation' : 'lootbar';
  const isApiLinked = isProviderApiLinked(userDoc, currentProvider);

  if (isG2Bulk && g2bulk) {
    const result = await g2bulk.placeOrder(
      playerName || (extraInfo.player_id ? String(extraInfo.player_id) : 'Unknown'),
      userDoc._id.toString(),
      gameId,
      skuId,
      extraInfo,
      ctx.chat!.id
    );
    if (result.success) {
      if (!result.order) return;
      return;
    } else {
      return await safeReply(ctx, `❌ G2Bulk Order Failed: ${escapeMd(result.error || 'Unknown Error')}`);
    }
  }

  if (isTopupNation && topupNation) {
    const result = await topupNation.placeOrder({
      telegramChatId: ctx.chat!.id,
      telegramUsername: currentTelegramUsername,
      telegramFirstName: currentTelegramFirstName,
      telegramLastName: currentTelegramLastName,
      productId: gameId,
      sku: skuId,
      fields: extraInfo,
      quantity: quantity,
      existingIdempotencyKey: idempotencyKey
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
      lines.push(`└── 💳 Remaining Balance: \`$${(updatedUser?.balance || 0).toFixed(3)}\``);
    } else {
      lines.push(`└── 💳 Payment: \`⚡ Direct API Balance Linked\``);
    }
    lines.push(`═════════════════════════`);

    await safeReply(ctx, lines.join('\n'), statusKeyboard);

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
      `├── 💰 Price: \`$${orderCost.toFixed(3)} USD\`\n` +
      (order.playerName ? `├── 🎯 Player/Account: \`${escapeCode(order.playerName)}\`\n` : '') +
      `├── 💳 Payment: \`${isApiLinked ? 'Direct API Linked' : 'Wallet Balance'}\`\n` +
      `├── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\`\n` +
      `└── 🆔 Order ID: \`${orderId}\`\n` +
      `═════════════════════════`;

    const notiSettings = await getNotificationSettings();
    if (currentAdminIdForNotify && notiSettings.adminOrderAlerts) {
      await safeSendMessage(bot.telegram, currentAdminIdForNotify, adminOrderNotificationMsg);
    }
    return;
  }

  if (!isApiLinked) {
    const deductedUser = await User.findOneAndUpdate(
      { telegramChatId: ctx.chat!.id, balance: { $gte: orderCost } },
      { $inc: { balance: -orderCost } },
      { returnDocument: 'after' }
    );
    if (!deductedUser) {
      return ctx.reply(`❌ Insufficient balance or order already in progress. Cost is $${orderCost.toFixed(3)}, but your balance is insufficient.`, mainMenu);
    }
    userDoc.balance = deductedUser.balance;
  }

  try {
    const orderResponse = await lootbar.createOrder(referenceId, gameId, skuId, quantity, extraInfo);
    
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
            quantity,
            paymentSource: isApiLinked ? 'api_balance' : 'wallet_balance'
          },
          state: 1,
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
        lines.push(`└── 💳 Remaining Balance: \`$${userDoc.balance.toFixed(3)}\``);
      } else {
        lines.push(`└── 💳 Payment: \`⚡ Direct API Balance Linked\``);
      }
      lines.push(`═════════════════════════`);

      await safeReply(ctx, lines.join('\n'), statusKeyboard);
      
      const currentAdminIdForNotify = await getAdminChatId(adminChatId);
      const fromUser = ctx.from?.username 
        ? `@${ctx.from.username}` 
        : (ctx.chat as any)?.username 
          ? `@${(ctx.chat as any).username}` 
          : ctx.from?.first_name || 'User';

      const safeFromUser = escapeMd(fromUser);

      const adminOrderNotificationMsg = `🔔 *New Top-Up Order Received!*\n` +
        `═════════════════════════\n` +
        `├── 👤 User: \`${ctx.chat!.id}\` (${safeFromUser})\n` +
        `├── 🎮 Game: *${safeGame}*\n` +
        `├── 📦 Package: *${safeSku}*\n` +
        `├── 💰 Price: \`$${orderCost.toFixed(3)} USD\`\n` +
        (playerName ? `├── 🎯 Player: \`${escapeCode(playerName)}\`\n` : '') +
        `├── 💳 Payment: \`${isApiLinked ? 'Direct API Linked' : 'Wallet Balance'}\`\n` +
        `├── 🕒 Time: \`${formatMyanmarDateTime(new Date())}\`\n` +
        `└── 🆔 Order ID: \`${orderId}\`\n` +
        `═════════════════════════`;
      
      const notiSettings = await getNotificationSettings();
      if (currentAdminIdForNotify && notiSettings.adminOrderAlerts) {
        await safeSendMessage(bot.telegram, currentAdminIdForNotify, adminOrderNotificationMsg);
      }

      // Background poller
      setTimeout(async () => {
        try {
          const queryRes = await lootbar.queryOrder(referenceId);
          const pollerNotiSettings = await getNotificationSettings();
          if (queryRes?.data?.state === 2) {
            await Order.findOneAndUpdate({ referenceId }, { state: 2 });
            if (pollerNotiSettings.lootbarEnabled) {
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
            }
          } else if (queryRes?.data?.state === 3) {
            await Order.findOneAndUpdate({ referenceId }, { state: 3 });
            if (!isApiLinked) {
              const userToRefund = await User.findOne({ telegramChatId: ctx.chat!.id });
              if (userToRefund) {
                userToRefund.balance += orderCost;
                await userToRefund.save();
              }
            }
            if (pollerNotiSettings.lootbarEnabled) {
              await safeSendMessage(
                bot.telegram, 
                ctx.chat!.id, 
                `❌ *Order Failed*\n═════════════════════════\n` +
                `├── 🆔 Order ID: \`${orderId || referenceId}\`\n` +
                `├── 🎮 Game: *${safeGame}*\n` +
                `├── ❌ Status: *FAILED*\n` +
                `└── 💬 Message: _Could not be fulfilled on game server_${!isApiLinked ? ` (Refunded $${orderCost.toFixed(3)} USD)` : ''}\n` +
                `═════════════════════════`
              );
            }
          }
        } catch (pollErr) {
          console.error('Polling order status error:', pollErr);
        }
      }, 12000);
    
    } else {
      if (!isApiLinked) {
        await User.updateOne({ telegramChatId: ctx.chat!.id }, { $inc: { balance: orderCost } });
      }
      const msg = orderResponse?.msg || orderResponse?.message || 'LootBar rejected the transaction';
      await safeReply(ctx, `❌ *Failed to Place Order*\n\nReason: \`${escapeCode(msg)}\`${!isApiLinked ? `\n\nYour balance of $${orderCost.toFixed(3)} has been refunded to your wallet.` : ''}`, mainMenu);
    }
  
  } catch (error: any) {
    if (!isApiLinked) {
      await User.updateOne({ telegramChatId: ctx.chat!.id }, { $inc: { balance: orderCost } });
    }
    console.error('Order placement failed:', error);
    await safeReply(ctx, `❌ *Order Error*\n\nReason: \`${escapeCode(error.message || 'Server error')}\`${!isApiLinked ? `\n\nYour balance of $${orderCost.toFixed(3)} has been refunded to your wallet.` : ''}`, mainMenu);
  }
}

export async function handleTrackOrderQuery(
  ctx: any, 
  queryId: string, 
  lootbar: LootBarClient,
  topupNation?: TopupNationService,
  isCallback: boolean = false
) {
  const cleanId = (queryId || '').trim();
  if (!cleanId) {
    if (isCallback) {
      try { await ctx.answerCbQuery('Invalid order identifier'); } catch {}
    }
    return ctx.reply('⚠️ Please provide a valid Order ID or Reference ID.');
  }

  try {
    let order = await Order.findOne({
      $or: [
        { referenceId: cleanId },
        { orderId: cleanId },
        { providerOrderId: cleanId },
        { providerReceiptNumber: cleanId }
      ]
    });

    if (!order) {
      order = await Order.findOne({
        $or: [
          { referenceId: { $regex: new RegExp(`^${cleanId}$`, 'i') } },
          { orderId: { $regex: new RegExp(`^${cleanId}$`, 'i') } },
          { providerOrderId: { $regex: new RegExp(`^${cleanId}$`, 'i') } }
        ]
      });
    }

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
          } catch (fallbackErr) {}
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
      `📡 *Live Order Status*\n═════════════════════════\n├── 🆔 Order: \`${escapeCode(cleanId)}\`\n├── 🔄 Status: *PROCESSING*\n└── 💬 Message: _Order is being processed on provider server_\n═════════════════════════`
    );
  }
}

export function registerOrderHandlers(
  bot: Telegraf<MyContext>,
  lootbar: LootBarClient,
  topupNation: TopupNationService | undefined,
  g2bulk: G2BulkService | undefined,
  adminChatId: string | undefined,
  mainMenu: any,
  activeUserOrderLocks: Map<number | string, number>,
  processedOrderMessages: Set<string>
) {
  bot.action('qty_inc', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.quantity = Math.min(100, (ctx.session.quantity || 1) + 1);
    await showOrderConfirmation(ctx, lootbar, topupNation, true);
  });

  bot.action('qty_dec', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.quantity = Math.max(1, (ctx.session.quantity || 1) - 1);
    await showOrderConfirmation(ctx, lootbar, topupNation, true);
  });

  bot.action(/^qty_set_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const qty = parseInt(ctx.match[1], 10) || 1;
    ctx.session.quantity = Math.max(1, Math.min(100, qty));
    await showOrderConfirmation(ctx, lootbar, topupNation, true);
  });

  bot.action('qty_prompt', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.step = 'INPUT_QUANTITY';
    return ctx.reply(
      `🔢 *အကြိမ်အရေအတွက် (Quantity / Count) သတ်မှတ်ရန်*\n\n` +
      `ဝယ်ယူလိုသော Package အကြိမ်အရေအတွက်ကို 1 မှ 100 အတွင်း ဂဏန်းဖြင့် ရိုက်ထည့်ပေးပါ (ဥပမာ- \`5\` သို့မဟုတ် \`10\`):\n\n` +
      `_သို့မဟုတ် မပြောင်းလဲလိုပါက အောက်ပါ Button ကို နှိပ်ပါ:_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Back to Confirmation', 'qty_back')],
          [Markup.button.callback('❌ Cancel Order', 'cancel_order')]
        ])
      }
    );
  });

  bot.action('qty_back', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.step = 'CONFIRM_ORDER';
    await showOrderConfirmation(ctx, lootbar, topupNation);
  });

  bot.action('confirm_place_order', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const now = Date.now();
    const lastLock = activeUserOrderLocks.get(chatId);
    if (lastLock && now - lastLock < 60000) {
      return await ctx.answerCbQuery('⚠️ Your order is already being processed! Please wait a moment...', { show_alert: true });
    }
    activeUserOrderLocks.set(chatId, now);

    const messageId = ctx.callbackQuery?.message?.message_id;
    const messageKey = messageId ? `${chatId}_${messageId}` : undefined;
    if (messageKey) {
      if (processedOrderMessages.has(messageKey)) {
        activeUserOrderLocks.delete(chatId);
        return await ctx.answerCbQuery('⚠️ This order was already submitted or is in progress!', { show_alert: true });
      }
      processedOrderMessages.add(messageKey);
      if (processedOrderMessages.size > 5000) {
        const toRemove = Array.from(processedOrderMessages).slice(0, 1000);
        toRemove.forEach(k => processedOrderMessages.delete(k));
      }
    }

    if (ctx.session?.orderInProgress || ctx.session?.step === 'PROCESSING' || ctx.session?.step === 'DONE') {
      activeUserOrderLocks.delete(chatId);
      return await ctx.answerCbQuery('⚠️ This order was already submitted or is in progress!', { show_alert: true });
    }
    ctx.session.orderInProgress = true;
    ctx.session.step = 'PROCESSING';

    let orderLockCreated = false;
    const extra = ctx.session?.extraInfo || {};
    const targetAccount = String(extra.userAccount || extra.uid || extra.player_id || ctx.session?.playerName || 'unknown').trim();
    const dbLockKey = `lock_${chatId}_${ctx.session?.gameId}_${ctx.session?.skuId}_${targetAccount}`;

    try {
      await OrderLock.create({ lockKey: dbLockKey, telegramChatId: chatId });
      orderLockCreated = true;
    } catch (lockErr: any) {
      if (lockErr?.code === 11000) {
        console.warn(`[OrderLock] Duplicate order blocked by MongoDB unique lock: ${dbLockKey}`);
        activeUserOrderLocks.delete(chatId);
        return await ctx.answerCbQuery('⚠️ Order is already being processed or was just submitted!', { show_alert: true });
      }
    }

    try {
      const lockDoc = await Session.findOneAndUpdate(
        {
          chatId,
          'data.orderInProgress': { $ne: true },
          'data.step': { $nin: ['PROCESSING', 'DONE'] }
        },
        {
          $set: {
            'data.orderInProgress': true,
            'data.step': 'PROCESSING'
          }
        }
      );
      if (!lockDoc) {
        activeUserOrderLocks.delete(chatId);
        if (orderLockCreated) {
          await OrderLock.deleteOne({ lockKey: dbLockKey }).catch(() => {});
        }
        return await ctx.answerCbQuery('⚠️ Order already in progress!', { show_alert: true });
      }
    } catch (e) {}

    ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    await ctx.answerCbQuery('⏳ Processing order...');

    try {
      await finalizeOrder(bot, ctx, lootbar, topupNation, g2bulk, adminChatId, mainMenu);
    } finally {
      activeUserOrderLocks.delete(chatId);
      if (ctx.session) {
        ctx.session.orderInProgress = false;
      }
    }
  });

  bot.action(/^order_filter_(all|lootbar|topupnation)_(all|mine)_page_(\d+)$/, async (ctx) => {
    const provider = ctx.match[1] as 'all' | 'lootbar' | 'topupnation';
    const scope = ctx.match[2] as 'all' | 'mine';
    const page = parseInt(ctx.match[3], 10) || 1;
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx, adminChatId, true, page, provider, scope);
  });

  bot.action(/^order_filter_(all|lootbar|topupnation)_page_(\d+)$/, async (ctx) => {
    const provider = ctx.match[1] as 'all' | 'lootbar' | 'topupnation';
    const page = parseInt(ctx.match[2], 10) || 1;
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx, adminChatId, true, page, provider);
  });

  bot.action(/^order_page_(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10) || 1;
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx, adminChatId, true, page, 'all');
  });

  bot.action('view_orders_action', async (ctx) => {
    await ctx.answerCbQuery();
    return await renderOrderHistory(ctx, adminChatId);
  });

  bot.command(['allorders', 'adminorders', 'all_orders', 'admin_orders', 'ownerorders'], async (ctx) => {
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(ctx.chat.id) !== currentAdminId) {
      return ctx.reply('🚫 Unauthorized: Owner only command.');
    }
    return await renderOrderHistory(ctx, adminChatId, false, 1, 'all', 'all');
  });

  bot.action('noop_page_indicator', async (ctx) => {
    await ctx.answerCbQuery();
  });

  bot.hears(['📜 Order History', 'Order History', 'Orders', 'orders', '📜 Orders', 'Live Status', 'Check Status', 'Status'], async (ctx) => {
    return await renderOrderHistory(ctx, adminChatId, false, 1, 'all');
  });

  bot.command(['orders', 'history', 'orderhistory'], async (ctx) => {
    return await renderOrderHistory(ctx, adminChatId, false, 1, 'all');
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
    return await handleTrackOrderQuery(ctx, orderQuery, lootbar, topupNation, false);
  });

  bot.action(/^track_order_(.+)$/, async (ctx) => {
    const queryId = ctx.match[1];
    return await handleTrackOrderQuery(ctx, queryId, lootbar, topupNation, true);
  });

  bot.action('refresh_order_history', async (ctx) => {
    await ctx.answerCbQuery('Refreshing order history...');
    return await renderOrderHistory(ctx, adminChatId, true, 1);
  });
}
