import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import { LootBarClient } from "./server/lootbar";
import { setupBot } from "./server/bot";
import { connectDB } from "./server/db";
import { SavedGame } from "./server/models/SavedGame";
import { Order } from "./server/models/Order";
import { AppConfig } from "./server/models/AppConfig";
import { User } from "./server/models/User";
import { TopupRequest } from "./server/models/TopupRequest";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.get('/favicon.ico', (req, res) => res.status(204).end());
// We need raw body for webhook verification
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Initialize MongoDB and load config
connectDB().then(async () => {
  try {
    const config = await AppConfig.findOne({ key: 'lootbar_credentials' });
    if (config && config.value) {
      lootbarClient.updateCredentials(config.value.nickname, config.value.email, config.value.password);
      console.log("Loaded LootBar credentials from MongoDB");
    }
  } catch (err) {
    console.error("Failed to load config from DB", err);
  }
});

// Initialize LootBar Client
const LOOTBAR_NICKNAME = process.env.LOOTBAR_NICKNAME || "";
const LOOTBAR_EMAIL = process.env.LOOTBAR_EMAIL || "";
const LOOTBAR_PASSWORD = process.env.LOOTBAR_PASSWORD || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const lootbarClient = new LootBarClient(LOOTBAR_NICKNAME, LOOTBAR_EMAIL, LOOTBAR_PASSWORD, undefined, APP_URL);

// Initialize Telegram Bot if Token is present
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const isServerless = !!process.env.VERCEL || process.env.IS_SERVERLESS === 'true';
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

let telegramBot: ReturnType<typeof setupBot> | undefined;
if (BOT_TOKEN && BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
  telegramBot = setupBot(BOT_TOKEN, ADMIN_CHAT_ID, lootbarClient, {
    isServerless,
    webhookUrl
  });

  // Mount Telegram webhook handler strictly on its dedicated route
  if (isServerless || webhookUrl) {
    app.use('/api/telegram-webhook', telegramBot.webhookCallback('/api/telegram-webhook'));
    app.use('/telegram-webhook', telegramBot.webhookCallback('/telegram-webhook'));
  }
} else {
  console.warn("TELEGRAM_BOT_TOKEN is missing or invalid. Bot will not start.");
}

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
      { upsert: true, new: true }
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
    res.json({ success: true, adminChatId: config?.value || process.env.ADMIN_CHAT_ID || '' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/settings/admin", async (req, res) => {
  const { adminChatId } = req.body;
  try {
    await AppConfig.findOneAndUpdate(
      { key: 'admin_chat_id' },
      { value: String(adminChatId) },
      { upsert: true, new: true }
    );
    res.json({ success: true });
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
      { upsert: true, new: true }
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
      { upsert: true, new: true }
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
      { new: true }
    );
    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/telegram-users/toggle-api-balance", async (req, res) => {
  const { chatId, useDirectApiBalance } = req.body;
  if (!chatId) return res.status(400).json({ error: "Chat ID is required" });
  try {
    const isApiBalance = !!useDirectApiBalance;
    const user = await User.findOneAndUpdate(
      { telegramChatId: Number(chatId) },
      { 
        useDirectApiBalance: isApiBalance,
        balanceMode: isApiBalance ? 'api' : 'wallet'
      },
      { upsert: true, new: true }
    );
    
    // Notify the user via Telegram Bot
    if (telegramBot) {
      try {
        if (isApiBalance) {
          const msg = `⚡ *Account Upgrade: Live API Balance Linked*\n\n` +
            `Admin has linked your Telegram account directly to the *LootBar API Live Balance*!\n\n` +
            `• 🚀 *Status:* \`Direct API Reseller / VIP\`\n` +
            `• 💳 *Balance Source:* Direct Live API\n` +
            `• ✨ You can now place top-up orders directly backed by live API balance.\n\n` +
            `Check your status anytime using /balance or 💳 My Balance.`;
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
      { upsert: true, new: true }
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
      { upsert: true, new: true }
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
      { new: true }
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
    const data = await lootbarClient.getGames();
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

            // Notify user on state transitions
            if (telegramBot) {
              if (newState === 2) {
                // Completed
                const msg = `🎉 *Top-Up Order Completed!*\n\n` +
                  `🎮 *Game:* ${order.gameName || 'Game'}\n` +
                  `🛍 *Product:* ${order.skuName || 'Top-up'}\n` +
                  (order.playerName ? `🎯 *Player:* \`${order.playerName}\`\n` : '') +
                  `🔖 *Ref ID:* \`${order.referenceId}\`\n` +
                  `✅ Your in-game item has been successfully delivered!`;
                try {
                  await telegramBot.telegram.sendMessage(order.telegramChatId, msg, { parse_mode: 'Markdown' });
                } catch (e) {
                  console.error('Failed to notify user of order completion:', e);
                }
              } else if (newState === 3) {
                // Failed -> Auto Refund
                const user = await User.findOne({ telegramChatId: order.telegramChatId });
                if (user && order.price > 0) {
                  user.balance += order.price;
                  await user.save();
                }
                const msg = `❌ *Top-Up Order Failed*\n\n` +
                  `🔖 *Ref ID:* \`${order.referenceId}\`\n` +
                  `Your wallet balance has been refunded ($${order.price.toFixed(2)} USD).`;
                try {
                  await telegramBot.telegram.sendMessage(order.telegramChatId, msg, { parse_mode: 'Markdown' });
                } catch (e) {
                  console.error('Failed to notify user of order failure:', e);
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

// Run active order sync every 8 seconds
setInterval(syncActiveOrders, 8000);

app.get("/api/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(100);
    res.setHeader('Content-Type', 'application/json');
    res.json({ success: true, data: orders });
    // Trigger sync in background non-blocking
    syncActiveOrders().catch(() => {});
  } catch (err: any) {
    res.status(500).json({ success: false, data: [], error: err.message });
  }
});

// Force sync a specific order in real time
app.post("/api/orders/:referenceId/sync", async (req, res) => {
  try {
    const { referenceId } = req.params;
    const order = await Order.findOne({ referenceId });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (!lootbarClient.isConfigured()) {
      return res.status(400).json({ error: "LootBar API not configured" });
    }

    const queryRes = await lootbarClient.queryOrder(referenceId);
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
    
    // Upsert the game with shortKey
    const saved = await SavedGame.findOneAndUpdate(
      { gameId },
      { name, shortKey: cleanShortKey },
      { upsert: true, new: true }
    );
    res.json({ data: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/saved-games/:gameId", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    const { shortKey, name } = req.body;
    const updateData: any = {};
    if (shortKey !== undefined) {
      updateData.shortKey = String(shortKey).toLowerCase().replace(/^[./]+/, '').trim();
    }
    if (name) updateData.name = name;

    const saved = await SavedGame.findOneAndUpdate(
      { gameId: req.params.gameId },
      updateData,
      { new: true }
    );
    res.json({ data: saved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

// ---------------------------------------------------------
// Webhook Endpoint
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
      { referenceId: reference_id },
      { orderId: order_id, state },
      { new: true }
    );

    if (order && telegramBot) {
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
