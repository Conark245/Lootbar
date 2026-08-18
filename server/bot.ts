import { Telegraf, Markup, Context } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { LootBarClient } from './lootbar';
import { Order } from './models/Order';
import { User } from './models/User';
import { Session } from './models/Session';
import { AppConfig } from './models/AppConfig';

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
  skus?: any[];
  skuId?: string;
  requiredFields?: any[];
  currentFieldIndex?: number;
  extraInfo?: Record<string, string>;
}

export interface MyContext extends Context {
  session: SessionData;
}

export function setupBot(botToken: string, adminChatId: string | undefined, lootbar: LootBarClient) {
  const bot = new Telegraf<MyContext>(botToken);
  
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

    let user = await User.findOne({ telegramChatId: chatId });
    
    // Auto-authorize admin
    const currentAdminId = await getAdminChatId(adminChatId);
    if (String(chatId) === currentAdminId) {
      if (!user) {
        user = await User.create({ telegramChatId: chatId, isAuthorized: true });
      } else if (!user.isAuthorized) {
        user = await User.findOneAndUpdate({ telegramChatId: chatId }, { isAuthorized: true }, { new: true });
      }
    } else {
      if (!user) {
        // Create user with isAuthorized: false to show up in UI and allow inline approval
        user = await User.create({ telegramChatId: chatId, isAuthorized: false });
      }
    }

    if (!user || !user.isAuthorized) {
      // If it's a message, inform them. Don't spam on callbacks.
      if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/start')) {
        await ctx.reply(`🚫 You are not authorized to use this bot.\n\nYour Chat ID is: \`${chatId}\`\n\nA request has been sent to the admin. Please wait for approval.`, { parse_mode: 'Markdown' });
        
        const currentAdminIdForNotify = await getAdminChatId(adminChatId);
        if (currentAdminIdForNotify) {
          try {
            await bot.telegram.sendMessage(
              adminChatId,
              `🔔 *New User Request*\nChat ID: \`${chatId}\`\nUsername: @${ctx.chat.username || 'Unknown'}\nName: ${ctx.chat.first_name || ''} ${ctx.chat.last_name || ''}`,
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

  const mainMenu = Markup.keyboard([
    ['🎮 Game List'],
    ['👤 My Account', '📜 Order History']
  ]).resize();

  bot.command('start', async (ctx) => {
    ctx.session = {}; // reset session
    return ctx.reply('Welcome to the Top-up Bot! Choose an option below:', mainMenu);
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

  bot.hears('👤 My Account', async (ctx) => {
    const user = await User.findOne({ telegramChatId: ctx.chat.id });
    if (!user) return ctx.reply('User not found.');
    return ctx.reply(`👤 *My Account*\n\nID: \`${ctx.chat.id}\`\nWallet Balance: ${user.balance}\nStatus: Authorized`, { parse_mode: 'Markdown' });
  });

  bot.hears('📜 Order History', async (ctx) => {
    const orders = await Order.find({ telegramChatId: ctx.chat.id }).sort({ createdAt: -1 }).limit(5);
    if (orders.length === 0) return ctx.reply('No recent orders found.');

    let msg = '📜 *Recent Orders*\n\n';
    const stateMap: Record<number, string> = {
      1: '⏳ Processing',
      2: '✅ Success',
      3: '❌ Failed',
      4: '⏳ Settling',
      5: '⚠️ Partial',
      6: '🚫 Cancelled',
      7: '🗑 Deleted'
    };

    orders.forEach((o, i) => {
      msg += `${i + 1}. Ref: \`${o.referenceId}\`\nStatus: ${stateMap[o.state] || 'Unknown'}\nDate: ${o.createdAt.toLocaleDateString()}\n\n`;
    });
    return ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.hears('🎮 Game List', async (ctx) => {
    ctx.session.step = 'SELECT_GAME';
    
    try {
      const response = await lootbar.getGames();
      const games = response?.data?.items || [];
      
      if (!games || games.length === 0) {
        return ctx.reply('No games currently available.');
      }

      const buttons = games.map((game: any) => 
        Markup.button.callback(game.game_name || 'Unknown Game', `game_${game.game_id}`)
      );
      
      // Group buttons in rows of 2
      const keyboard = [];
      for (let i = 0; i < buttons.length; i += 2) {
        keyboard.push(buttons.slice(i, i + 2));
      }

      return ctx.reply('Please select a game:', Markup.inlineKeyboard(keyboard));
    } catch (error: any) {
      console.error('Failed to fetch games:', error);
      return ctx.reply(`An error occurred while fetching the game list: ${error.message}`);
    }
  });

  bot.action(/^game_(.+)$/, async (ctx) => {
    const gameId = ctx.match[1];
    ctx.session.gameId = gameId;
    
    try {
      const response = await lootbar.getSkus(gameId);
      const skus = response?.data?.items || [];
      
      if (!skus || skus.length === 0) {
        return ctx.editMessageText('No SKUs available for this game at the moment.');
      }

      ctx.session.skus = skus;

      const buttons = skus.map((sku: any) => {
        const name = sku.sku_name || 'Unknown SKU';
        return Markup.button.callback(name, `sku_${sku.sku_id}`);
      });

      // 1 button per row for SKUs to allow longer names
      const keyboard = buttons.map(btn => [btn]);

      ctx.session.step = 'SELECT_SKU';
      return ctx.editMessageText('Please select an SKU to top-up:', Markup.inlineKeyboard(keyboard));
    } catch (error: any) {
      console.error('Failed to fetch SKUs:', error);
      return ctx.editMessageText(`An error occurred while fetching SKUs: ${error.message}`);
    }
  });

  bot.action(/^sku_(.+)$/, async (ctx) => {
    const skuId = ctx.match[1];
    ctx.session.skuId = skuId;
    
    const skus = ctx.session.skus || [];
    const selectedSku = skus.find(s => String(s.sku_id) === skuId);
    
    if (!selectedSku) {
      return ctx.editMessageText('SKU not found. Please try again.');
    }

    // Default to 'uid' if not specified
    const requiredFields = (selectedSku.extra_info || [])
      .filter((f: any) => f.required);
    if (requiredFields.length === 0) {
      requiredFields.push({ name: 'uid', title: 'UID', type: 'input' });
    }
    
    ctx.session.requiredFields = requiredFields;
    ctx.session.extraInfo = {};
    ctx.session.currentFieldIndex = 0;
    ctx.session.step = 'INPUT_EXTRA_INFO';

    return await askNextRequiredField(ctx);
  });

  async function askNextRequiredField(ctx: MyContext) {
    const requiredFields = ctx.session.requiredFields || [];
    const currentIndex = ctx.session.currentFieldIndex || 0;
    const nextField = requiredFields[currentIndex];

    const promptText = `Please provide your ${nextField.title || nextField.name}:`;

    if (nextField.type === 'select' && Array.isArray(nextField.options)) {
      const buttons = nextField.options.map((opt: any) => {
        const val = typeof opt === 'object' ? opt.value : opt;
        const label = typeof opt === 'object' ? opt.title || opt.label || val : val;
        // Keep callback_data under 64 chars. 'opt_{field}_{value}'
        return Markup.button.callback(String(label), `opt_${nextField.name}_${val}`.substring(0, 64));
      });
      // Group by 2
      const keyboard = [];
      for (let i = 0; i < buttons.length; i += 2) {
        keyboard.push(buttons.slice(i, i + 2));
      }
      return ctx.reply(promptText, Markup.inlineKeyboard(keyboard));
    } else {
      return ctx.reply(promptText);
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

    if (currentField.name !== fieldName) {
      return ctx.answerCbQuery('Unexpected option selection.');
    }

    if (!ctx.session.extraInfo) ctx.session.extraInfo = {};
    ctx.session.extraInfo[currentField.name] = value;

    await ctx.answerCbQuery();
    await ctx.editMessageText(`Selected ${currentField.title || currentField.name}: ${value}`);

    const nextIndex = currentIndex + 1;
    if (nextIndex < requiredFields.length) {
      ctx.session.currentFieldIndex = nextIndex;
      await askNextRequiredField(ctx);
    } else {
      await finalizeOrder(ctx);
    }
  });

  bot.on('text', async (ctx) => {
    if (ctx.session.step !== 'INPUT_EXTRA_INFO') return;
    
    const userInput = ctx.message.text;
    const requiredFields = ctx.session.requiredFields || [];
    const currentIndex = ctx.session.currentFieldIndex || 0;
    
    if (requiredFields.length === 0) return;

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
      await ctx.reply(`Thank you.`);
      await askNextRequiredField(ctx);
    } else {
      await finalizeOrder(ctx);
    }
  });

  async function finalizeOrder(ctx: MyContext) {
    ctx.session.step = 'DONE';
    await ctx.reply('All information collected. Processing your order...');
    
    const referenceId = uuidv4().replace(/-/g, '');
    const gameId = ctx.session.gameId!;
    const skuId = ctx.session.skuId!;
    const extraInfo = ctx.session.extraInfo;
    
    
    const userDoc = await User.findOne({ telegramChatId: ctx.chat!.id });
    if (!userDoc) {
      return ctx.reply('❌ User not found.');
    }
    
    // Attempt to get price from SKU, fallback to 1 unit if not available
    let orderCost = 1;
    const selectedSku = (ctx.session.skus || []).find((s: any) => String(s.sku_id) === String(skuId));
    if (selectedSku && selectedSku.price) {
      orderCost = parseFloat(selectedSku.price);
    }
    
    if (userDoc.balance < orderCost) {
      return ctx.reply(`❌ Insufficient balance. Cost is ${orderCost}, but your balance is ${userDoc.balance}.`);
    }

    // Deduct balance
    userDoc.balance -= orderCost;
    await userDoc.save();

    try {
      const orderResponse = await lootbar.createOrder(referenceId, gameId, skuId, 1, extraInfo);
      
      if (orderResponse?.status === 'ok' && orderResponse?.data?.order_id) {
        try {
          await Order.create({
            referenceId,
            orderId: orderResponse.data.order_id,
            telegramChatId: ctx.chat!.id,
            gameId: ctx.session.gameId,
            skuId,
            extraInfo,
            state: 1,
          });
        } catch (dbErr) {
          console.error('Failed to save order to MongoDB:', dbErr);
        }
        await ctx.reply(`✅ Order successfully placed!\nReference ID: ${referenceId}\n\nYou will receive the top-up shortly.`);
        
        const notificationMsg = `🔔 New Order Received!\nRef ID: ${referenceId}\nSKU ID: ${skuId}\nDetails: ${JSON.stringify(extraInfo)}`;
        
        if (adminChatId) {
          try {
            await bot.telegram.sendMessage(currentAdminIdForNotify, notificationMsg);
          } catch (e) {
            console.error('Failed to notify admin:', e);
          }
        }

        try {
          const notifyUsers = await User.find({ receivesNotifications: true });
          for (const u of notifyUsers) {
            if (String(u.telegramChatId) === currentAdminIdForNotify) continue;
            try {
              await bot.telegram.sendMessage(u.telegramChatId, notificationMsg);
            } catch (e) {
              console.error(`Failed to notify user ${u.telegramChatId}:`, e);
            }
          }
        } catch (dbErr) {
           console.error('Failed to fetch notification users:', dbErr);
        }
      
      } else {
        // Refund balance if order failed
        userDoc.balance += orderCost;
        await userDoc.save();
        const msg = orderResponse?.msg || orderResponse?.message || 'Unknown error';
        await ctx.reply(`❌ Failed to place order.\nReason: ${msg}`);
      }
    
    } catch (error: any) {
      // Refund balance on exception
      userDoc.balance += orderCost;
      await userDoc.save();
      console.error('Order placement failed:', error);

      await ctx.reply(`❌ Failed to place order: ${error.message || 'Please contact support.'}`);
    }
  }

  // Start polling in background
  bot.launch().catch(err => {
    console.error("Failed to launch bot. Is the TELEGRAM_BOT_TOKEN valid?", err.message);
  });
  console.log("Telegram bot initialized.");
  
  return bot;
}
