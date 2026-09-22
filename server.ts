import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { LootBarClient } from "./server/providers/lootbar/LootBarClient";
import { TopupNationClient } from "./server/providers/topupnation/TopupNationClient";
import { TopupNationService } from "./server/providers/topupnation/TopupNationService";
import { G2BulkClient } from "./server/providers/g2bulk/G2BulkClient";
import { G2BulkService } from "./server/providers/g2bulk/G2BulkService";
import { setupBot } from "./server/bot";
import { PricePoller } from "./server/pricePoller";
import { connectDB } from "./server/db";
import { SavedGame } from "./server/models/SavedGame";
import { Order } from "./server/models/Order";
import { AppConfig } from "./server/models/AppConfig";
import { User } from "./server/models/User";
import { TopupRequest } from "./server/models/TopupRequest";
import { TopupNationProduct } from "./server/models/TopupNationProduct";
import { G2BulkProduct } from "./server/models/G2BulkProduct";
import { BulkOrderService } from "./server/bulkOrderService";
import { isProviderApiLinked } from "./server/bot/helpers";
import { getNotificationSettings, updateNotificationSettings, INotificationSettings } from "./server/notificationSettings";
import { createServer as createViteServer } from "vite";

dotenv.config();

// Prevent server crash from unhandled rejections (e.g. Telegram 409 Conflict)
process.on('unhandledRejection', (reason: any, promise) => {
  if (reason?.response?.error_code === 409 || reason?.message?.includes('409: Conflict')) {
    console.warn('⚠️ Telegram Bot Polling Conflict (409) absorbed: Another instance is running. Ignoring to prevent crash...');
  } else {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  }
});

// Prevent server crash from transient network socket resets/timeouts
process.on('uncaughtException', (error: any) => {
  if (
    error?.code === 'ECONNRESET' ||
    error?.code === 'ETIMEDOUT' ||
    error?.code === 'ENOTFOUND' ||
    error?.message?.includes('409: Conflict')
  ) {
    console.warn(`⚠️ [Transient Network Exception absorbed]:`, error.message || error);
    return;
  }
  console.error('Uncaught Exception:', error);
});

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Cloud / Container Healthcheck endpoints (Railway, Docker, Uptime monitors)
const healthHandler = (req: express.Request, res: express.Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);
// We need raw body for webhook verification
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Initialize LootBar Client
const LOOTBAR_NICKNAME = process.env.LOOTBAR_NICKNAME || "";
const LOOTBAR_EMAIL = process.env.LOOTBAR_EMAIL || "";
const LOOTBAR_PASSWORD = process.env.LOOTBAR_PASSWORD || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const lootbarClient = new LootBarClient(LOOTBAR_NICKNAME, LOOTBAR_EMAIL, LOOTBAR_PASSWORD, undefined, APP_URL);

// Initialize TopupNation Client & Service
const TOPUPNATION_API_KEY = process.env.TOPUPNATION_API_KEY || "";
const TOPUPNATION_API_SECRET = process.env.TOPUPNATION_API_SECRET || "";
const TOPUPNATION_WEBHOOK_SECRET = process.env.TOPUPNATION_WEBHOOK_SECRET || "";
const topupNationClient = new TopupNationClient({
  apiKey: TOPUPNATION_API_KEY,
  apiSecret: TOPUPNATION_API_SECRET,
  webhookSecret: TOPUPNATION_WEBHOOK_SECRET
});
const topupNationService = new TopupNationService(topupNationClient);

const g2bulkClient = new G2BulkClient({
  apiKey: process.env.G2BULK_API_KEY || ''
});
const g2bulkService = new G2BulkService(g2bulkClient);


const pricePoller = new PricePoller(lootbarClient, topupNationService, g2bulkService);

// Initialize Telegram Bot State
let telegramBot: ReturnType<typeof setupBot> | undefined;
let activeBotToken: string = process.env.TELEGRAM_BOT_TOKEN || '';
let activeAdminChatId: string = process.env.ADMIN_CHAT_ID || '';
const isServerless = !!process.env.VERCEL || process.env.IS_SERVERLESS === 'true';
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

// Function to safely stop and (re)start the bot
async function initOrRestartTelegramBot(token: string, adminChatId: string) {
  if (telegramBot) {
    try {
      telegramBot.stop('Restarting due to token change');
    } catch (e) {}
    telegramBot = undefined;
  }
  
  if (token && token !== 'YOUR_BOT_TOKEN_HERE') {
    activeBotToken = token;
    activeAdminChatId = adminChatId;
    
    telegramBot = setupBot(token, adminChatId, lootbarClient, {
      isServerless,
      webhookUrl
    }, topupNationService, g2bulkService);

    // Provide Telegram instance to provider services for order status notifications
    topupNationService.setTelegram(telegramBot.telegram, adminChatId);
    g2bulkService.setTelegram(telegramBot.telegram, adminChatId);
    pricePoller.setTelegram(telegramBot);
  } else {
    console.warn("TELEGRAM_BOT_TOKEN is missing or invalid. Bot will not start.");
  }
}

// Dynamically mount Telegram webhook handler strictly on its dedicated routes
if (isServerless || webhookUrl) {
  app.use('/api/telegram-webhook', (req, res, next) => {
    if (telegramBot) return telegramBot.webhookCallback('/api/telegram-webhook')(req, res, next);
    next();
  });
  app.use('/telegram-webhook', (req, res, next) => {
    if (telegramBot) return telegramBot.webhookCallback('/telegram-webhook')(req, res, next);
    next();
  });
}

// Initialize MongoDB and load config
connectDB().then(async () => {
  try {
    const config = await AppConfig.findOne({ key: 'lootbar_credentials' });
    if (config && config.value) {
      lootbarClient.updateCredentials(config.value.nickname, config.value.email, config.value.password);
      console.log("Loaded LootBar credentials from MongoDB");
    }

    const tpnConfig = await AppConfig.findOne({ key: 'topupnation_credentials' });
    if (tpnConfig && tpnConfig.value) {
      topupNationClient.updateCredentials(tpnConfig.value);
      console.log("Loaded TopupNation credentials from MongoDB");
    }

    const g2bulkConfig = await AppConfig.findOne({ key: 'g2bulk_credentials' });
    if (g2bulkConfig?.value?.apiKey) {
      (g2bulkClient as any).apiKey = g2bulkConfig.value.apiKey;
    }
    
    // Load Telegram configuration from DB
    const adminConfig = await AppConfig.findOne({ key: 'admin_chat_id' });
    if (adminConfig && adminConfig.value) {
      activeAdminChatId = adminConfig.value;
    }
    
    const tokenConfig = await AppConfig.findOne({ key: 'telegram_bot_token' });
    if (tokenConfig && tokenConfig.value) {
      activeBotToken = tokenConfig.value;
      console.log("Loaded Telegram Bot Token from MongoDB");
    }
    
    // Initialize the bot after reading from DB
    initOrRestartTelegramBot(activeBotToken, activeAdminChatId);
    
  } catch (err) {
    console.error("Failed to load config from DB", err);
  }
});

// Periodic background poller for active TopupNation orders
setInterval(() => {
  topupNationService.pollActiveOrders().catch((err) => {
    console.error("Error in TopupNation background poller:", err);
  });
}, 15000); // 15 seconds

// Periodic background poller for active G2Bulk orders
setInterval(() => {
  g2bulkService.pollActiveOrders().catch((err) => {
    console.error("Error in G2Bulk background poller:", err);
  });
}, 15000); // 15 seconds

// Periodic background poller for price updates (every 30 minutes)
setInterval(() => {
  pricePoller.pollPrices().catch((err) => {
    console.error("Error in PricePoller:", err);
  });
}, 30 * 60 * 1000);

// Run an initial price check a few seconds after startup
setTimeout(() => {
  pricePoller.pollPrices().catch(console.error);
}, 10000);

// ---------------------------------------------------------
// REST Endpoints
// ---------------------------------------------------------

app.post("/api/settings/lootbar", async (req, res) => {
  const { email, password, nickname } = req.body;
  
  if (!email || !password || !nickname) {
    return res.status(400).json({ error: "Missing required credentials" });
  }

  try {
    // 1. Temporarily test credentials
    const testClient = new LootBarClient(nickname, email, password);
    await testClient.testLogin(); // This will test the login directly

    // 2. If successful, update global client
    lootbarClient.updateCredentials(nickname, email, password);

    // 3. Save to MongoDB
    await AppConfig.findOneAndUpdate(
      { key: 'lootbar_credentials' },
      { value: { email, password, nickname } },
      { upsert: true, returnDocument: 'after' }
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Failed to authenticate with LootBar" });
  }
});

app.get("/api/settings/lootbar/status", async (req, res) => {
  try {
    const config = await AppConfig.findOne({ key: 'lootbar_credentials' });
    res.json({ 
      isConfigured: !!config || (!!process.env.LOOTBAR_EMAIL && !!process.env.LOOTBAR_PASSWORD)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/lootbar/balance", async (req, res) => {
  try {
    if (!lootbarClient.isConfigured()) {
      return res.json({ success: false, data: null, error: "LootBar not configured" });
    }
    const asset = await lootbarClient.queryAsset();
    res.json({ success: true, data: asset.data });
  } catch (err: any) {
    res.json({ success: false, data: null, error: err.message });
  }
});

app.get("/api/settings/admin", async (req, res) => {
  try {
    const config = await AppConfig.findOne({ key: 'admin_chat_id' });
    const tokenConfig = await AppConfig.findOne({ key: 'telegram_bot_token' });
    res.json({ 
      success: true, 
      adminChatId: config?.value || process.env.ADMIN_CHAT_ID || '',
      telegramBotToken: tokenConfig?.value || process.env.TELEGRAM_BOT_TOKEN || ''
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/settings/admin", async (req, res) => {
  const { adminChatId, telegramBotToken } = req.body;
  try {
    await AppConfig.findOneAndUpdate(
      { key: 'admin_chat_id' },
      { value: String(adminChatId) },
      { upsert: true, returnDocument: 'after' }
    );
    
    if (telegramBotToken !== undefined) {
      await AppConfig.findOneAndUpdate(
        { key: 'telegram_bot_token' },
        { value: String(telegramBotToken) },
        { upsert: true, returnDocument: 'after' }
      );
      
      // Attempt to restart/reinitialize bot if the token changed
      initOrRestartTelegramBot(telegramBotToken, adminChatId);
    } else {
      initOrRestartTelegramBot(activeBotToken, adminChatId);
    }
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Notification Settings Endpoints
// ==========================================
app.get("/api/settings/notifications", async (req, res) => {
  try {
    const settings = await getNotificationSettings();
    res.json({ success: true, settings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/settings/notifications", async (req, res) => {
  try {
    const {
      lootbarEnabled,
      topupnationEnabled,
      g2bulkEnabled,
      adminOrderAlerts,
      priceChangeAlerts,
      priceChangeLootbar,
      priceChangeTopupnation,
      priceChangeG2bulk
    } = req.body;
    const updated = await updateNotificationSettings({
      ...(lootbarEnabled !== undefined && { lootbarEnabled: !!lootbarEnabled }),
      ...(topupnationEnabled !== undefined && { topupnationEnabled: !!topupnationEnabled }),
      ...(g2bulkEnabled !== undefined && { g2bulkEnabled: !!g2bulkEnabled }),
      ...(adminOrderAlerts !== undefined && { adminOrderAlerts: !!adminOrderAlerts }),
      ...(priceChangeAlerts !== undefined && { priceChangeAlerts: !!priceChangeAlerts }),
      ...(priceChangeLootbar !== undefined && { priceChangeLootbar: !!priceChangeLootbar }),
      ...(priceChangeTopupnation !== undefined && { priceChangeTopupnation: !!priceChangeTopupnation }),
      ...(priceChangeG2bulk !== undefined && { priceChangeG2bulk: !!priceChangeG2bulk }),
    });
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/settings/notifications/toggle", async (req, res) => {
  try {
    const { key, enabled } = req.body;
    if (!key) return res.status(400).json({ error: "Notification key is required" });
    const updated = await updateNotificationSettings({ [key]: !!enabled });
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram-users/balance", async (req, res) => {
  const { chatId, amount } = req.body;
  if (!chatId || typeof amount !== 'number') return res.status(400).json({ error: "Chat ID and valid amount required" });
  try {
    const user = await User.findOneAndUpdate(
      { telegramChatId: Number(chatId) },
      { $inc: { balance: amount } },
      { upsert: true, returnDocument: 'after' }
    );
    
    // Notify the user via Telegram Bot
    if (telegramBot) {
      try {
        const action = amount >= 0 ? "added to" : "deducted from";
        const msg = `💰 Your balance has been updated.\n\n${Math.abs(amount)} has been ${action} your account.\nCurrent Balance: ${user.balance}`;
        await telegramBot.telegram.sendMessage(chatId, msg);
      } catch (e) {
        console.error(`Failed to notify user ${chatId} of balance update:`, e);
      }
    }
    
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Telegram User Management Routes
app.get("/api/telegram-users", async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.json({ success: true, data: users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram-users/auth", async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: "Chat ID is required" });
  try {
    const user = await User.findOneAndUpdate(
      { telegramChatId: Number(chatId) },
      { isAuthorized: true },
      { upsert: true, returnDocument: 'after' }
    );
    
    // Notify the user via Telegram Bot
    if (telegramBot) {
      try {
        await telegramBot.telegram.sendMessage(chatId, '🎉 Good news! You have been authorized by the admin.\n\nSend /start to begin using the bot.');
      } catch (e) {
        console.error(`Failed to notify user ${chatId} of authorization:`, e);
      }
    }
    
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram-users/unauth", async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: "Chat ID is required" });
  try {
    const user = await User.findOneAndUpdate(
      { telegramChatId: Number(chatId) },
      { isAuthorized: false },
      { returnDocument: 'after' }
    );
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram-users/toggle-api-balance", async (req, res) => {
  const { chatId, useDirectApiBalance, apiProvider = 'both' } = req.body;
  if (!chatId) return res.status(400).json({ error: "Chat ID is required" });
  try {
    const isApiBalance = !!useDirectApiBalance;
    const selectedProvider = ['lootbar', 'topupnation', 'g2bulk', 'both', 'all'].includes(apiProvider) ? apiProvider : 'both';

    const user = await User.findOneAndUpdate(
      { telegramChatId: Number(chatId) },
      { 
        useDirectApiBalance: isApiBalance,
        balanceMode: isApiBalance ? 'api' : 'wallet',
        apiProvider: selectedProvider
      },
      { upsert: true, returnDocument: 'after' }
    );
    
    // Notify the user via Telegram Bot
    if (telegramBot) {
      try {
        if (isApiBalance) {
          const providerLabel = selectedProvider === 'both' 
            ? 'LootBar & TopupNation APIs' 
            : selectedProvider === 'topupnation' 
              ? 'TopupNation API' 
              : 'LootBar API';

          const msg = `⚡ *Account Upgrade: Live API Balance Linked*\n\n` +
            `Admin has linked your Telegram account directly to the *${providerLabel}*!\n\n` +
            `• 🚀 *Status:* \`Direct API Reseller / VIP\`\n` +
            `• 🌐 *Active Provider(s):* \`${selectedProvider.toUpperCase()}\`\n` +
            `• 💳 *Balance Source:* Direct Live API Funds\n` +
            `• ✨ You can now place top-up orders directly backed by live API balance.\n\n` +
            `Check your status anytime using /balance, /apibalance or 💳 Check Balance.`;
          try {
            await telegramBot.telegram.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
          } catch {
            await telegramBot.telegram.sendMessage(chatId, msg.replace(/[*_`]/g, ''));
          }
        } else {
          const msg = `💳 *Account Notice: Switched to Wallet Mode*\n\n` +
            `Your account balance mode has been changed to standard *Wallet Balance* mode.\n` +
            `Current Wallet Balance: $${Number(user.balance || 0).toFixed(2)} USD`;
          try {
            await telegramBot.telegram.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
          } catch {
            await telegramBot.telegram.sendMessage(chatId, msg.replace(/[*_`]/g, ''));
          }
        }
      } catch (e) {
        console.error(`Failed to notify user ${chatId} of API balance mode change:`, e);
      }
    }
    
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram-users/update-notes", async (req, res) => {
  const { chatId, notes } = req.body;
  if (!chatId) return res.status(400).json({ error: "Chat ID is required" });
  try {
    const user = await User.findOneAndUpdate(
      { telegramChatId: Number(chatId) },
      { notes: String(notes || '') },
      { upsert: true, returnDocument: 'after' }
    );
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/telegram-users/:chatId", async (req, res) => {
  const { chatId } = req.params;
  if (!chatId) return res.status(400).json({ error: "Chat ID is required" });
  try {
    await User.findOneAndDelete({ telegramChatId: Number(chatId) });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram-users/toggle-notifications", async (req, res) => {
  const { chatId, receivesNotifications } = req.body;
  if (!chatId) return res.status(400).json({ error: "Chat ID is required" });
  try {
    const user = await User.findOneAndUpdate(
      { telegramChatId: Number(chatId) },
      { receivesNotifications: !!receivesNotifications },
      { upsert: true, returnDocument: 'after' }
    );
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Top-up Requests Management API
app.get("/api/topup-requests", async (req, res) => {
  try {
    const requests = await TopupRequest.find({}).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: requests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/topup-requests/:requestId/approve", async (req, res) => {
  const { requestId } = req.params;
  const { processedBy } = req.body;
  try {
    const request = await TopupRequest.findOne({ requestId });
    if (!request) return res.status(404).json({ error: "Top-up request not found" });
    if (request.status !== 'pending') return res.status(400).json({ error: `Request already ${request.status}` });

    request.status = 'approved';
    request.processedBy = processedBy || 'Admin Web';
    request.processedAt = new Date();
    await request.save();

    const user = await User.findOneAndUpdate(
      { telegramChatId: request.telegramChatId },
      { $inc: { balance: request.amount } },
      { returnDocument: 'after' }
    );

    if (telegramBot) {
      try {
        const userSuccessMsg = `🎉 *Balance Top-Up Approved!*\n\n` +
          `💰 *Added Amount:* \`+$${request.amount.toFixed(2)} USD\`\n` +
          `💳 *New Wallet Balance:* \`$${Number(user?.balance || 0).toFixed(2)} USD\`\n` +
          `🆔 *Request ID:* \`${requestId}\`\n\n` +
          `သင့် Wallet ထဲသို့ ငွေဖြည့်သွင်းခြင်း အောင်မြင်ပါပြီ။`;
        await telegramBot.telegram.sendMessage(request.telegramChatId, userSuccessMsg, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error(`Failed to notify user ${request.telegramChatId}:`, e);
      }
    }

    res.json({ success: true, data: request, user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/topup-requests/:requestId/reject", async (req, res) => {
  const { requestId } = req.params;
  const { processedBy } = req.body;
  try {
    const request = await TopupRequest.findOne({ requestId });
    if (!request) return res.status(404).json({ error: "Top-up request not found" });
    if (request.status !== 'pending') return res.status(400).json({ error: `Request already ${request.status}` });

    request.status = 'rejected';
    request.processedBy = processedBy || 'Admin Web';
    request.processedAt = new Date();
    await request.save();

    if (telegramBot) {
      try {
        const userRejectMsg = `❌ *Top-Up Request Declined*\n\n` +
          `💰 *Requested Amount:* \`$${request.amount.toFixed(2)} USD\`\n` +
          `🆔 *Request ID:* \`${requestId}\`\n\n` +
          `သင့် ငွေဖြည့်သွင်းမှု တောင်းဆိုချက်ကို Admin မှ ပယ်ဖျက်လိုက်ပါသည်။`;
        await telegramBot.telegram.sendMessage(request.telegramChatId, userRejectMsg, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error(`Failed to notify user ${request.telegramChatId}:`, e);
      }
    }

    res.json({ success: true, data: request });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/games", async (req, res) => {
  try {
    if (!lootbarClient.isConfigured()) {
      return res.json({ error: "LootBar not configured", data: { items: [] } });
    }
    const data = await lootbarClient.getGames(1, 100);
    if (data?.data?.total_page && data.data.total_page > 1) {
      let allItems = [...(data.data.items || [])];
      for (let p = 2; p <= data.data.total_page; p++) {
        try {
          const nextData = await lootbarClient.getGames(p, 100);
          if (nextData?.data?.items) {
            allItems = allItems.concat(nextData.data.items);
          }
        } catch (e) {
          console.error(`Failed to fetch LootBar games page ${p}`, e);
        }
      }
      data.data.items = allItems;
    }
    res.json(data);
  } catch (err: any) {
    res.json({ error: err.message, data: { items: [] } });
  }
});


app.get("/api/skus", async (req, res) => {
  try {
    if (!lootbarClient.isConfigured()) {
      return res.json({ error: "LootBar not configured", data: { items: [] } });
    }
    const data = await lootbarClient.getSkus(req.query.game_id as string);
    res.json(data);
  } catch (err: any) {
    res.json({ error: err.message, data: { items: [] } });
  }
});

app.post("/api/order", async (req, res) => {
  try {
    const { reference_id, game_id, sku_id, quantity, extra_info } = req.body;
    const data = await lootbarClient.createOrder(reference_id, game_id, sku_id, quantity || 1, extra_info);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk Order: Parse & Preview
app.post("/api/orders/bulk/preview", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: "Text is required" });
    }
    const result = await BulkOrderService.parseBulkText(text, lootbarClient);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bulk Order: Execute
app.post("/api/orders/bulk/execute", async (req, res) => {
  try {
    const { telegramChatId, userId, items, isDirectApi } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Items array is required" });
    }

    let targetUser: any = null;
    if (telegramChatId) {
      targetUser = await User.findOne({ telegramChatId });
    } else if (userId) {
      targetUser = await User.findById(userId);
    }

    if (!targetUser) {
      // Create or use fallback Admin Direct API user
      targetUser = await User.findOne({ telegramChatId: 0 });
      if (!targetUser) {
        targetUser = await User.create({
          telegramChatId: 0,
          username: "admin_direct",
          firstName: "System Admin",
          balanceMode: isDirectApi !== false ? "api" : "wallet",
          useDirectApiBalance: true,
          balance: 999999
        });
      }
    }

    const summary = await BulkOrderService.executeBulkOrders(
      targetUser,
      items,
      lootbarClient,
      topupNationService,
      g2bulkService,
      { rawText: req.body.rawText, source: 'web' }
    );

    res.json({ success: true, data: summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bulk Order: History List
app.get("/api/orders/bulk/history", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const telegramChatId = req.query.telegramChatId ? parseInt(req.query.telegramChatId as string) : undefined;

    const data = await BulkOrderService.getBulkHistory({
      page,
      limit,
      telegramChatId
    });

    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bulk Order: Batch Detail
app.get("/api/orders/bulk/batch/:batchId", async (req, res) => {
  try {
    const batch = await BulkOrderService.getBulkBatchById(req.params.batchId);
    if (!batch) {
      return res.status(404).json({ success: false, error: "Bulk batch not found" });
    }
    res.json({ success: true, data: batch });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/order/:referenceId", async (req, res) => {
  try {
    const data = await lootbarClient.queryOrder(req.params.referenceId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/asset", async (req, res) => {
  try {
    const data = await lootbarClient.queryAsset();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// Real-Time Order Sync Engine
// ---------------------------------------------------------
async function syncActiveOrders() {
  if (!lootbarClient.isConfigured()) return;
  if (mongoose.connection.readyState !== 1) return;
  try {
    // Find active orders that are in Pending (0), In Transaction (1), or Settling (4)
    const activeOrders = await Order.find({
      state: { $in: [0, 1, 4] }
    }).sort({ createdAt: -1 }).limit(20);

    for (const order of activeOrders) {
      try {
        const queryRes = await lootbarClient.queryOrder(order.referenceId);
        if (queryRes && queryRes.status === 'ok' && queryRes.data) {
          const newState = queryRes.data.state;
          const orderId = queryRes.data.order_id || order.orderId;
          
          if (newState !== undefined && newState !== order.state) {
            console.log(`[Order Sync] Order ${order.referenceId} transitioned from state ${order.state} -> ${newState}`);
            
            order.state = newState;
            if (orderId) order.orderId = orderId;
            await order.save();

            // Notify only the relevant user who placed this order
            const notiSettings = await getNotificationSettings();
            if (telegramBot && notiSettings.lootbarEnabled) {
              const safeGame = (order.gameName || 'Game').replace(/[*_`\[\]]/g, '');
              const safeSku = (order.skuName || 'Top-up').replace(/[*_`\[\]]/g, '');
              const safeOrderNum = (order.orderId || order.referenceId || '').replace(/[*_`\[\]]/g, '');
              const safePlayer = order.playerName ? order.playerName.replace(/[*_`\[\]]/g, '') : '';

              if (newState === 2) {
                // Completed
                const lines = [
                  `🎉 *Top-Up Completed!*`,
                  `═════════════════════════`,
                  `├── 🆔 Order ID: \`${safeOrderNum}\``,
                  `├── 🎮 Game: *${safeGame}*`,
                  `├── 📦 Package: *${safeSku}*`,
                ];
                if (safePlayer) {
                  lines.push(`├── 👤 Player: \`${safePlayer}\``);
                }
                lines.push(`├── ✅ Status: *COMPLETED*`);
                lines.push(`└── 💬 Message: _Fulfilled successfully on game server_`);
                lines.push(`═════════════════════════`);

                const msg = lines.join('\n');
                try {
                  await telegramBot.telegram.sendMessage(order.telegramChatId, msg, { parse_mode: 'Markdown' });
                } catch (e) {
                  try {
                    await telegramBot.telegram.sendMessage(order.telegramChatId, msg.replace(/[*_`]/g, ''));
                  } catch (err2) {
                    console.error('Failed to notify user of order completion:', err2);
                  }
                }
              } else if (newState === 3) {
                // Failed -> Auto Refund
                const user = await User.findOne({ telegramChatId: order.telegramChatId });
                const orderProvider = order.provider || (order.extraInfo as any)?.provider || 'lootbar';
                const isApiLinked = isProviderApiLinked(user, orderProvider);
                if (user && order.price > 0 && !isApiLinked) {
                  user.balance += order.price;
                  await user.save();
                }

                const lines = [
                  `❌ *Top-Up Order Failed*`,
                  `═════════════════════════`,
                  `├── 🆔 Order ID: \`${safeOrderNum}\``,
                  `├── 🎮 Game: *${safeGame}*`,
                  `├── 📦 Package: *${safeSku}*`,
                  `├── ❌ Status: *FAILED*`,
                  `└── 💬 Message: _Could not be fulfilled on game server_${!isApiLinked ? ` (Refunded $${order.price.toFixed(2)} USD to wallet)` : ''}`,
                  `═════════════════════════`
                ];

                const msg = lines.join('\n');
                try {
                  await telegramBot.telegram.sendMessage(order.telegramChatId, msg, { parse_mode: 'Markdown' });
                } catch (e) {
                  try {
                    await telegramBot.telegram.sendMessage(order.telegramChatId, msg.replace(/[*_`]/g, ''));
                  } catch (err2) {
                    console.error('Failed to notify user of order failure:', err2);
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        // Individual order query failed (e.g. rate limit), continue next
      }
    }
  } catch (err) {
    console.error('Active order sync cycle error:', err);
  }
}

// Backfill missing telegramUsername and info on existing orders
async function backfillOrderUsernames() {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const ordersWithoutUsername = await Order.find({
      $or: [
        { telegramUsername: { $exists: false } },
        { telegramUsername: null },
        { telegramUsername: '' }
      ]
    }).limit(1000);

    if (ordersWithoutUsername.length > 0) {
      const chatIds = Array.from(new Set(ordersWithoutUsername.map(o => o.telegramChatId)));
      const users = await User.find({ telegramChatId: { $in: chatIds } });
      const userMap = new Map(users.map(u => [u.telegramChatId, u]));

      let count = 0;
      for (const ord of ordersWithoutUsername) {
        const u = userMap.get(ord.telegramChatId);
        if (u && (u.username || u.firstName)) {
          if (u.username) ord.telegramUsername = u.username;
          if (u.firstName) ord.telegramFirstName = u.firstName;
          await ord.save();
          count++;
        }
      }
      if (count > 0) {
        console.log(`[Database Migration] Populated Telegram username on ${count} orders.`);
      }
    }
  } catch (e) {
    console.error('Order username backfill notice:', e);
  }
}

// Trigger initial backfill
setTimeout(backfillOrderUsernames, 2000);

// Run active order sync every 8 seconds
setInterval(syncActiveOrders, 8000);

app.get("/api/orders", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const query: any = {};
    if (search) {
      const cleanSearch = search.replace(/^@/, '');
      const searchRegex = new RegExp(cleanSearch, 'i');
      const conditions: any[] = [
        { orderId: searchRegex },
        { referenceId: searchRegex },
        { providerOrderId: searchRegex },
        { telegramUsername: searchRegex },
        { telegramFirstName: searchRegex },
        { gameName: searchRegex },
        { skuName: searchRegex },
        { playerName: searchRegex }
      ];
      if (!isNaN(Number(search))) {
        conditions.push({ telegramChatId: Number(search) });
      }
      query.$or = conditions;
    }
    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(limit);
    res.setHeader('Content-Type', 'application/json');
    res.json({ success: true, data: orders });
    // Trigger sync in background non-blocking
    syncActiveOrders().catch(() => {});
    topupNationService.pollActiveOrders().catch(() => {});
  } catch (err: any) {
    res.status(500).json({ success: false, data: [], error: err.message });
  }
});

// Force sync a specific order in real time (Supports LootBar and TopupNation)
app.post("/api/orders/:referenceId/sync", async (req, res) => {
  try {
    const { referenceId } = req.params;
    const order = await Order.findOne({
      $or: [
        { referenceId },
        { orderId: referenceId },
        { providerOrderId: referenceId }
      ]
    });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const isTpn = order.provider === 'topupnation' || order.extraInfo?.provider === 'topupnation';
    if (isTpn) {
      if (!topupNationClient.isConfigured()) {
        return res.status(400).json({ error: "TopupNation API not configured" });
      }
      const orderIdToQuery = order.providerOrderId || order.orderId || order.referenceId;
      const tpnRes = await topupNationClient.queryOrder(orderIdToQuery);
      if (tpnRes && tpnRes.status) {
        const statusUpper = tpnRes.status.toUpperCase();
        let newState = order.state;
        if (statusUpper === 'SUCCESS') newState = 2;
        else if (statusUpper === 'FAILED' || statusUpper === 'REFUNDED') newState = 3;
        else if (statusUpper === 'PROCESSING') newState = 1;
        
        order.state = newState;
        order.statusText = statusUpper;
        if (tpnRes.id) order.providerOrderId = tpnRes.id;
        if (tpnRes.receiptNumber) order.providerReceiptNumber = tpnRes.receiptNumber;
        await order.save();
        return res.json({ success: true, data: order, apiData: tpnRes });
      }
      return res.json({ success: true, data: order, message: "No change from TopupNation API" });
    }

    const isG2b = order.provider === 'g2bulk' || order.extraInfo?.provider === 'g2bulk';
    if (isG2b) {
      if (!g2bulkClient.isConfigured()) {
        return res.status(400).json({ error: "G2Bulk API not configured" });
      }
      const orderIdToQuery = order.providerOrderId || order.orderId || order.referenceId;
      const g2bRes = await g2bulkClient.getOrder(orderIdToQuery);
      if (g2bRes && (g2bRes.status || g2bRes.order_status)) {
        const rawStatus = String(g2bRes.status || g2bRes.order_status || '').toUpperCase();
        let newState = order.state;
        if (['SUCCESS', 'COMPLETED'].includes(rawStatus)) newState = 2;
        else if (['FAILED', 'REFUNDED', 'CANCELED', 'CANCELLED'].includes(rawStatus)) newState = 3;
        else if (['PROCESSING', 'PENDING', 'IN_PROGRESS'].includes(rawStatus)) newState = 1;
        
        order.state = newState;
        order.statusText = rawStatus;
        if (g2bRes.id || g2bRes.order_id) order.providerOrderId = String(g2bRes.id || g2bRes.order_id);
        await order.save();
        return res.json({ success: true, data: order, apiData: g2bRes });
      }
      return res.json({ success: true, data: order, message: "No change from G2Bulk API" });
    }

    if (!lootbarClient.isConfigured()) {
      return res.status(400).json({ error: "LootBar API not configured" });
    }

    const queryRes = await lootbarClient.queryOrder(order.referenceId);
    if (queryRes && queryRes.status === 'ok' && queryRes.data) {
      const newState = queryRes.data.state;
      const orderId = queryRes.data.order_id || order.orderId;
      
      if (newState !== undefined) {
        order.state = newState;
        if (orderId) order.orderId = orderId;
        await order.save();
      }

      return res.json({
        success: true,
        data: order,
        apiData: queryRes.data
      });
    }

    res.json({ success: true, data: order, message: "No change from API" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// MongoDB Endpoints (Saved Games)
// ---------------------------------------------------------

app.get("/api/saved-games", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.json({ data: [] });
    }
    const savedGames = await SavedGame.find().sort({ savedAt: -1 });
    res.json({ data: savedGames });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function getDefaultShortKey(name: string, gameId: string): string {
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
  
  // Extract acronym or clean first word
  const words = n.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words.map(w => w[0]).join('').slice(0, 4);
  }
  return words[0]?.slice(0, 4) || `g${gameId}`;
}

app.post("/api/saved-games", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    const { gameId, name, shortKey } = req.body;
    if (!gameId || !name) {
      return res.status(400).json({ error: "gameId and name are required" });
    }

    const cleanShortKey = (shortKey || getDefaultShortKey(name, gameId))
      .toLowerCase()
      .replace(/^[./]+/, '')
      .trim();
    
    // Fetch initial SKUs from LootBar if available
    let initialSkus: any[] = [];
    if (lootbarClient.isConfigured()) {
      try {
        const skuRes = await lootbarClient.getSkus(gameId);
        if (skuRes?.data?.items && Array.isArray(skuRes.data.items)) {
          initialSkus = skuRes.data.items;
        }
      } catch (e) {}
    }

    const updateDoc: any = { name, shortKey: cleanShortKey };
    if (initialSkus.length > 0) {
      updateDoc.lastKnownSkus = initialSkus;
    }

    // Upsert the game with shortKey
    const saved = await SavedGame.findOneAndUpdate(
      { gameId },
      updateDoc,
      { upsert: true, returnDocument: 'after' }
    );
    res.json({ data: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/saved-games/:gameId/skus", async (req, res) => {
  try {
    const { gameId } = req.params;
    let skus: any[] = [];

    // 1. Try to fetch live SKUs from LootBar API
    if (lootbarClient.isConfigured()) {
      try {
        const skuRes = await lootbarClient.getSkus(gameId);
        if (skuRes?.data?.items && Array.isArray(skuRes.data.items) && skuRes.data.items.length > 0) {
          skus = skuRes.data.items;
          // Cache to database
          if (process.env.MONGODB_URI) {
            await SavedGame.findOneAndUpdate({ gameId }, { lastKnownSkus: skus });
          }
        }
      } catch (err: any) {
        console.warn(`Could not fetch live SKUs from LootBar for ${gameId}:`, err.message);
      }
    }

    // 2. Fallback to cached SKUs in DB if live fetch was empty
    if (skus.length === 0 && process.env.MONGODB_URI) {
      const game = await SavedGame.findOne({ gameId });
      if (game && game.lastKnownSkus && game.lastKnownSkus.length > 0) {
        skus = game.lastKnownSkus;
      }
    }

    res.json({ success: true, data: skus });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, data: [] });
  }
});

app.patch("/api/saved-games/:gameId", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    const { shortKey, name, skuShortKeys } = req.body;
    const updateData: any = {};
    if (shortKey !== undefined) {
      updateData.shortKey = String(shortKey).toLowerCase().replace(/^[./]+/, '').trim();
    }
    if (name) updateData.name = name;
    if (skuShortKeys !== undefined) updateData.skuShortKeys = skuShortKeys;

    const saved = await SavedGame.findOneAndUpdate(
      { gameId: req.params.gameId },
      updateData,
      { returnDocument: 'after' }
    );
    res.json({ success: true, data: saved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/saved-games/:gameId", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    await SavedGame.findOneAndDelete({ gameId: req.params.gameId });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/saved-games/:gameId/toggle", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    const { isEnabled } = req.body;
    const game = await SavedGame.findOne({ gameId: req.params.gameId });
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    game.isEnabled = isEnabled !== undefined ? Boolean(isEnabled) : !game.isEnabled;
    await game.save();
    res.json({ success: true, data: game });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/saved-games/bulk-toggle", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    const { gameIds, isEnabled, gamesData } = req.body;
    if (!Array.isArray(gameIds)) {
      return res.status(400).json({ error: "gameIds array is required." });
    }

    const enabledVal = Boolean(isEnabled);

    // If enabling and gamesData (name, id) provided, upsert them
    if (enabledVal && Array.isArray(gamesData) && gamesData.length > 0) {
      const ops = gamesData.map((g: any) => {
        const gId = String(g.id || g.game_id || g.gameId);
        const gName = g.name || g.game_name || 'Game';
        const shortKey = g.shortKey || getDefaultShortKey(gName, gId);
        return {
          updateOne: {
            filter: { gameId: gId },
            update: {
              $set: {
                name: gName,
                isEnabled: true
              },
              $setOnInsert: {
                shortKey,
                savedAt: new Date(),
                skuShortKeys: {}
              }
            },
            upsert: true
          }
        };
      });
      await SavedGame.bulkWrite(ops);
    } else {
      await SavedGame.updateMany(
        { gameId: { $in: gameIds.map(String) } },
        { $set: { isEnabled: enabledVal } }
      );
    }

    const allSaved = await SavedGame.find().sort({ savedAt: -1 });
    res.json({ success: true, count: gameIds.length, data: allSaved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/saved-games/toggle-all", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    const { isEnabled, allGamesData } = req.body;
    const enabledVal = Boolean(isEnabled);

    if (enabledVal) {
      // Upsert all games from allGamesData if provided, or fetch from LootBar
      let gamesList = allGamesData;
      if (!Array.isArray(gamesList) || gamesList.length === 0) {
        try {
          const resp = await lootbarClient.getGames();
          gamesList = resp?.data?.items || [];
        } catch (e) {
          gamesList = [];
        }
      }

      if (Array.isArray(gamesList) && gamesList.length > 0) {
        const ops = gamesList.map((g: any) => {
          const gId = String(g.id || g.game_id || g.gameId);
          const gName = g.name || g.game_name || 'Game';
          const shortKey = g.shortKey || getDefaultShortKey(gName, gId);
          return {
            updateOne: {
              filter: { gameId: gId },
              update: {
                $set: {
                  name: gName,
                  isEnabled: true
                },
                $setOnInsert: {
                  shortKey,
                  savedAt: new Date(),
                  skuShortKeys: {}
                }
              },
              upsert: true
            }
          };
        });
        await SavedGame.bulkWrite(ops);
      } else {
        await SavedGame.updateMany({}, { $set: { isEnabled: true } });
      }
    } else {
      await SavedGame.updateMany({}, { $set: { isEnabled: false } });
    }

    const allSaved = await SavedGame.find().sort({ savedAt: -1 });
    res.json({ success: true, count: allSaved.length, isEnabled: enabledVal, data: allSaved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Global Master Toggle across all or selected providers
app.post("/api/games/global-bulk-toggle", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    const { isEnabled, provider = 'all', items } = req.body;
    const enabledVal = Boolean(isEnabled);
    const results: any = {};

    if (Array.isArray(items) && items.length > 0) {
      const lbIds = items.filter(it => it.provider === 'lootbar').map(it => String(it.id));
      const tpnIds = items.filter(it => it.provider === 'topupnation').map(it => String(it.id));
      const g2bIds = items.filter(it => it.provider === 'g2bulk').map(it => String(it.id));

      if (lbIds.length > 0) {
        await SavedGame.updateMany({ gameId: { $in: lbIds } }, { $set: { isEnabled: enabledVal } });
        results.lootbar = lbIds.length;
      }
      if (tpnIds.length > 0) {
        await TopupNationProduct.updateMany(
          { productId: { $in: tpnIds } },
          { $set: { isEnabled: enabledVal, status: enabledVal ? 'ACTIVE' : 'DISABLED' } }
        );
        results.topupnation = tpnIds.length;
      }
      if (g2bIds.length > 0) {
        await G2BulkProduct.updateMany(
          { productId: { $in: g2bIds } },
          { $set: { isEnabled: enabledVal, status: enabledVal ? 'ACTIVE' : 'DISABLED' } }
        );
        results.g2bulk = g2bIds.length;
      }

      return res.json({ success: true, isEnabled: enabledVal, modified: results });
    }

    if (provider === 'all' || provider === 'lootbar') {
      await SavedGame.updateMany({}, { $set: { isEnabled: enabledVal } });
      results.lootbar = await SavedGame.countDocuments();
    }
    if (provider === 'all' || provider === 'topupnation') {
      await TopupNationProduct.updateMany({}, { $set: { isEnabled: enabledVal, status: enabledVal ? 'ACTIVE' : 'DISABLED' } });
      results.topupnation = await TopupNationProduct.countDocuments();
    }
    if (provider === 'all' || provider === 'g2bulk') {
      await G2BulkProduct.updateMany({}, { $set: { isEnabled: enabledVal, status: enabledVal ? 'ACTIVE' : 'DISABLED' } });
      results.g2bulk = await G2BulkProduct.countDocuments();
    }

    res.json({ success: true, isEnabled: enabledVal, provider, modified: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// TopupNation Provider Endpoints
// ---------------------------------------------------------

app.post("/api/settings/topupnation", async (req, res) => {
  const { apiKey, webhookSecret, baseUrl } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: "apiKey is required." });
  }

  try {
    // 1. Temporarily test credentials
    const testClient = new TopupNationClient({
      apiKey,
      
      webhookSecret,
      baseUrl: baseUrl || "https://topupnation.io"
    });
    
    // Test connection with balance check
    await testClient.getBalance();

    // 2. Update server client
    topupNationClient.updateCredentials({
      apiKey,
      
      webhookSecret,
      baseUrl: baseUrl || "https://topupnation.io"
    });

    // 3. Save to MongoDB
    await AppConfig.findOneAndUpdate(
      { key: 'topupnation_credentials' },
      { value: { apiKey,  webhookSecret, baseUrl: baseUrl || "https://topupnation.io" } },
      { upsert: true, returnDocument: 'after' }
    );

    res.json({ success: true, message: "TopupNation credentials saved and verified successfully." });
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Failed to authenticate with TopupNation API." });
  }
});

app.get("/api/settings/topupnation/status", async (req, res) => {
  try {
    const config = await AppConfig.findOne({ key: 'topupnation_credentials' });
    const isConfigured = !!(config?.value?.apiKey && config?.value?.apiSecret) || topupNationClient.isConfigured();
    res.json({
      isConfigured,
      baseUrl: config?.value?.baseUrl || "https://topupnation.io",
      webhookUrl: `${(process.env.APP_URL || "").replace(/\/$/, "")}/api/webhooks/topupnation`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/topupnation/balance", async (req, res) => {
  try {
    if (!topupNationClient.isConfigured()) {
      return res.json({ success: false, data: null, error: "TopupNation API is not configured." });
    }
    const balanceData = await topupNationClient.getBalance();
    res.json({ success: true, data: balanceData });
  } catch (err: any) {
    res.json({ success: false, data: null, error: err.message });
  }
});

app.get("/api/topupnation/products", async (req, res) => {
  try {
    const products = await topupNationService.getProducts();
    res.json({ success: true, data: products });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/topupnation/products/sync", async (req, res) => {
  try {
    if (!topupNationClient.isConfigured()) {
      return res.status(400).json({ error: "TopupNation API is not configured." });
    }
    const syncResult = await topupNationService.syncProducts();
    const allProducts = await topupNationService.getProducts();
    res.json({ success: true, count: syncResult.synced, total: syncResult.total, data: allProducts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.post("/api/topupnation/products/:productId/sku-shortkeys", async (req, res) => {
  try {
    const { skuShortKeys } = req.body;
    const product = await TopupNationProduct.findOneAndUpdate(
      { productId: req.params.productId },
      { skuShortKeys: skuShortKeys },
      { returnDocument: 'after' }
    );
    res.json({ success: true, data: product });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/topupnation/products/:productId/shortkey", async (req, res) => {
  try {
    const productId = decodeURIComponent(req.params.productId);
    const { shortKey } = req.body;
    const cleanKey = shortKey !== undefined && shortKey !== null ? String(shortKey).trim().toLowerCase().replace(/^[./]+/, '').replace(/[^a-z0-9_-]/g, '') : '';

    const updated = await topupNationService.updateProductShortKey(productId, cleanKey);
    if (!updated) {
      return res.status(404).json({ success: false, error: "Product not found." });
    }

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.post("/api/topupnation/products/bulk-toggle", async (req, res) => {
  try {
    const { productIds, isEnabled } = req.body;
    if (!Array.isArray(productIds)) {
      return res.status(400).json({ error: "productIds array is required." });
    }
    const result = await topupNationService.bulkToggleProductsEnabled(productIds, isEnabled);
    res.json({ success: true, count: result.modifiedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/topupnation/products/toggle-all", async (req, res) => {
  try {
    const { isEnabled } = req.body;
    const enabledVal = Boolean(isEnabled);
    const result = await TopupNationProduct.updateMany(
      {},
      { $set: { isEnabled: enabledVal, status: enabledVal ? 'ACTIVE' : 'DISABLED' } }
    );
    res.json({ success: true, count: result.modifiedCount, isEnabled: enabledVal });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/topupnation/products/:productId/toggle", async (req, res) => {
  try {
    const { productId } = req.params;
    const { isEnabled } = req.body;
    const updated = await topupNationService.toggleProductEnabled(productId, isEnabled);
    if (!updated) {
      return res.status(404).json({ error: "Product not found." });
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/topupnation/order", async (req, res) => {
  try {
    const { telegramChatId, productId, sku, fields, quantity } = req.body;
    if (!telegramChatId || !productId || !sku || !fields) {
      return res.status(400).json({ error: "Missing required order parameters." });
    }

    const result = await topupNationService.placeOrder({
      telegramChatId: Number(telegramChatId),
      productId: String(productId),
      sku: String(sku),
      fields,
      quantity: Number(quantity) || 1
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/webhooks/topupnation", async (req: any, res) => {
  const signature = req.header("X-Signature") || req.header("x-signature") || "";
  const rawBody = req.rawBody || JSON.stringify(req.body);

  const result = await topupNationService.handleWebhook(req.body, signature, rawBody);
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }

  res.json({ success: true, message: "Webhook processed successfully." });
});

// ---------------------------------------------------------
// Webhook Endpoint (LootBar)
// ---------------------------------------------------------

app.post("/notify", async (req: any, res) => {
  const xInnerAuthorization = req.header("X-Inner-Authorization");
  
  if (!xInnerAuthorization) {
    return res.status(401).json({ detail: "Missing signature header." });
  }

  // Ensure auth to have callbackKey
  try {
    if (!lootbarClient.callbackKey) {
      await lootbarClient.getGames(); // Trigger login to fetch callbackKey if not present
    }
  } catch(e) {}

  if (!lootbarClient.callbackKey) {
    return res.status(500).json({ detail: "Callback key not available to verify webhook." });
  }

  const method = req.method;
  const pathQuery = req.originalUrl; // express originalUrl includes path + query
  const bodyStr = req.rawBody || "";

  const isValid = lootbarClient.verifyWebhookSignature(method, pathQuery, bodyStr, xInnerAuthorization);

  if (!isValid) {
    return res.status(401).json({ detail: "Invalid signature. Unauthorized webhook request." });
  }

  const { reference_id, order_id, state } = req.body;

  try {
    const order = await Order.findOneAndUpdate(
      { referenceId: reference_id, state: { $ne: state } },
      { orderId: order_id, state },
      { returnDocument: 'after' }
    );

    const notiSettings = await getNotificationSettings();
    if (order && telegramBot && notiSettings.lootbarEnabled) {
      const stateMessages: Record<number, string> = {
        2: `✅ Your top-up (Ref: ${reference_id}) was completed successfully!`,
        3: `❌ Your top-up (Ref: ${reference_id}) failed. Please contact support.`,
        5: `⚠️ Your top-up (Ref: ${reference_id}) was partially successful. Please contact support.`,
        6: `🚫 Your top-up (Ref: ${reference_id}) was cancelled.`,
      };
      const msg = stateMessages[state];
      if (msg) {
        try {
          await telegramBot.telegram.sendMessage(order.telegramChatId, msg);
        } catch (e) {
          console.error('Failed to notify user of order status change:', e);
        }
      }
    }
  } catch (error) {
    console.error('Error processing webhook order update:', error);
  }

  res.json({ status: "success", message: "Webhook processed" });
});


// ---------------------------------------------------------
// Vite SPA Fallback
// ---------------------------------------------------------
async function startServer() {
  // Aggressive anti-caching middleware to prevent stale chunks
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  
// ==========================================
// G2Bulk Admin API Endpoints
// ==========================================

app.get('/api/settings/g2bulk/status', async (req, res) => {
  try {
    const config = await AppConfig.findOne({ key: 'g2bulk_credentials' });
    const hasEnvKey = !!process.env.G2BULK_API_KEY;
    const isConfigured = hasEnvKey || !!config?.value?.apiKey;
    
    // If env key exists but no DB config exists, create a default DB config for isEnabled
    if (hasEnvKey && !config) {
      await AppConfig.create({
        key: 'g2bulk_credentials',
        value: { apiKey: '', isEnabled: true }
      });
    }

    res.json({
      success: true,
      isConfigured: isConfigured,
      webhookUrl: `https://${req.headers.host}/api/webhooks/g2bulk`,
      isEnabled: config?.value?.isEnabled !== false
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/g2bulk', async (req, res) => {
  try {
    const { apiKey, isEnabled } = req.body;
    
    // Test the API key if provided
    if (apiKey) {
        g2bulkClient.updateCredentials({ apiKey });
        try {
            await g2bulkClient.getBalance();
        } catch (e: any) {
             return res.json({ success: false, error: 'Invalid API Key or API error: ' + e.message });
        }
    } else if (process.env.G2BULK_API_KEY) {
        g2bulkClient.updateCredentials({ apiKey: process.env.G2BULK_API_KEY });
    }
    
    await AppConfig.findOneAndUpdate(
      { key: 'g2bulk_credentials' },
      { value: { apiKey, isEnabled } },
      { upsert: true }
    );
    
    res.json({ success: true, webhookUrl: `https://${req.headers.host}/api/webhooks/g2bulk` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/g2bulk/balance', async (req, res) => {
  try {
    const balance = await g2bulkClient.getBalance();
    res.json({ success: true, data: balance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/g2bulk/products', async (req, res) => {
  try {
    const products = await G2BulkProduct.find({}).sort({ name: 1 });
    res.json({ success: true, data: products });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/g2bulk/products/sync', async (req, res) => {
  try {
    await g2bulkService.syncProducts();
    const products = await G2BulkProduct.find({}).sort({ name: 1 });
    res.json({ success: true, data: products });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/g2bulk/products/:productId/toggle', async (req, res) => {
  try {
    const { isEnabled } = req.body;
    await G2BulkProduct.findOneAndUpdate(
      { productId: req.params.productId },
      { isEnabled }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/g2bulk/products/bulk-toggle', async (req, res) => {
  try {
    const { productIds, isEnabled } = req.body;
    if (!Array.isArray(productIds)) {
      return res.status(400).json({ error: "productIds array is required." });
    }
    const result = await g2bulkService.bulkToggleProductsEnabled(productIds, isEnabled);
    res.json({ success: true, count: result.modifiedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/g2bulk/products/toggle-all', async (req, res) => {
  try {
    const { isEnabled } = req.body;
    const enabledVal = Boolean(isEnabled);
    const result = await G2BulkProduct.updateMany(
      {},
      { $set: { isEnabled: enabledVal, status: enabledVal ? 'ACTIVE' : 'DISABLED' } }
    );
    res.json({ success: true, count: result.modifiedCount, isEnabled: enabledVal });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/g2bulk/products/:productId/shortkey', async (req, res) => {
  try {
    const productId = decodeURIComponent(req.params.productId);
    const { shortKey } = req.body;
    const cleanKey = shortKey !== undefined && shortKey !== null ? String(shortKey).trim().toLowerCase().replace(/^[./]+/, '').replace(/[^a-z0-9_-]/g, '') : '';
    const updated = await G2BulkProduct.findOneAndUpdate(
      { productId },
      { shortKey: cleanKey },
      { returnDocument: 'after' }
    );
    res.json({ success: true, data: updated, product: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/g2bulk/products/:productId/sku-shortkeys', async (req, res) => {
  try {
    const productId = decodeURIComponent(req.params.productId);
    const { skuShortKeys } = req.body;
    const cleanedMap: Record<string, string> = {};
    if (skuShortKeys && typeof skuShortKeys === 'object') {
      for (const [k, v] of Object.entries(skuShortKeys)) {
        if (v) cleanedMap[String(k)] = String(v).trim().toLowerCase().replace(/^[./]+/, '').replace(/[^a-z0-9_-]/g, '');
      }
    }
    const updated = await G2BulkProduct.findOneAndUpdate(
      { productId },
      { skuShortKeys: cleanedMap },
      { returnDocument: 'after' }
    );
    res.json({ success: true, data: updated, product: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/webhooks/g2bulk', express.json(), async (req, res) => {
  try {
    await g2bulkService.handleWebhook(req.body);
    res.json({ success: true });
  } catch (err: any) {
    console.error('G2Bulk Webhook Error:', err);
    res.status(500).json({ error: err.message });
  }
});


  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
export { app, startServer };

