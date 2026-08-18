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
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
const PORT = 3000;

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

let telegramBot: ReturnType<typeof setupBot> | undefined;
if (BOT_TOKEN && BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
  telegramBot = setupBot(BOT_TOKEN, ADMIN_CHAT_ID, lootbarClient);
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
    await testClient.getGames(); // This will trigger login

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

app.post("/api/saved-games", async (req, res) => {
  try {
    if (!process.env.MONGODB_URI) {
      return res.status(400).json({ error: "Database not configured" });
    }
    const { gameId, name } = req.body;
    if (!gameId || !name) {
      return res.status(400).json({ error: "gameId and name are required" });
    }
    
    // Upsert the game
    const saved = await SavedGame.findOneAndUpdate(
      { gameId },
      { name },
      { upsert: true, new: true }
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

startServer();
