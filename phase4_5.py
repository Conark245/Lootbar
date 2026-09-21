import re
import os
import shutil

# --- PHASE 4: G2Bulk Poller and Webhook Secret ---

with open('server/providers/g2bulk/G2BulkService.ts', 'r', encoding='utf-8') as f:
    g2bulk_svc_code = f.read()

poller_code = """
  public async pollActiveOrders(): Promise<void> {
    if (!this.client.isConfigured()) return;
    if (mongoose.connection.readyState !== 1) return;

    try {
      const activeOrders = await Order.find({
        provider: 'g2bulk',
        state: { $in: [0, 1] }
      }).sort({ createdAt: -1 }).limit(20);

      for (const order of activeOrders) {
        if (!order.providerOrderId) continue;
        try {
          const liveOrder = await this.client.getOrder(order.providerOrderId);
          // TODO: confirm the exact status field name/values G2Bulk's /orders endpoint
          // returns (check the reseller API docs) before trusting this mapping in production.
          const liveStatus = String(liveOrder?.status || '').toUpperCase();
          if (!liveStatus) continue;

          let newState = order.state;
          if (liveStatus === 'COMPLETED' || liveStatus === 'SUCCESS') newState = 2;
          else if (liveStatus === 'FAILED' || liveStatus === 'REFUNDED' || liveStatus === 'CANCELLED') newState = 3;

          if (newState !== order.state) {
            await Order.findOneAndUpdate(
              { _id: order._id, state: { $ne: newState } },
              { $set: { state: newState, statusText: liveStatus } }
            );
            if (newState === 3) {
              const user = await User.findOne({ telegramChatId: order.telegramChatId });
              if (user) {
                user.balance += (order.price || 0);
                await user.save();
              }
            }
          }
        } catch (err) {
          console.error(`[G2Bulk Poller] Failed to check order ${order.providerOrderId}:`, err);
        }
      }
    } catch (err) {
      console.error('[G2Bulk Poller] Error:', err);
    }
  }
"""

if 'public async pollActiveOrders' not in g2bulk_svc_code:
    g2bulk_svc_code = g2bulk_svc_code.replace("public async syncCatalog", poller_code + "\n  public async syncCatalog")
    with open('server/providers/g2bulk/G2BulkService.ts', 'w', encoding='utf-8') as f:
        f.write(g2bulk_svc_code)

with open('server.ts', 'r', encoding='utf-8') as f:
    server_code = f.read()

if 'g2bulkService.pollActiveOrders' not in server_code:
    fzr_poller = """// Periodic background poller for active FZR Cards orders
setInterval(() => {
  fzrCardsService.pollActiveOrders().catch((err) => {
    console.error("Error in FZR Cards background poller:", err);
  });
}, 15000); // 15 seconds"""

    g2bulk_poller = """// Periodic background poller for active FZR Cards orders
setInterval(() => {
  fzrCardsService.pollActiveOrders().catch((err) => {
    console.error("Error in FZR Cards background poller:", err);
  });
}, 15000); // 15 seconds

// Periodic background poller for active G2Bulk orders
setInterval(() => {
  g2bulkService.pollActiveOrders().catch((err) => {
    console.error("Error in G2Bulk background poller:", err);
  });
}, 15000); // 15 seconds"""

    server_code = server_code.replace(fzr_poller, g2bulk_poller)

webhook_note = """app.post("/api/webhooks/g2bulk", async (req: any, res) => {
  // NOTE: The G2Bulk API documentation does not specify a webhook signature mechanism 
  // (like X-Signature) for payload verification. This endpoint is currently unauthenticated 
  // by provider design. Ensure IP whitelisting in production if possible.
  try {"""
if 'NOTE: The G2Bulk API documentation does not specify a webhook signature mechanism' not in server_code:
    server_code = server_code.replace('app.post("/api/webhooks/g2bulk", async (req: any, res) => {\n  try {', webhook_note)

with open('server.ts', 'w', encoding='utf-8') as f:
    f.write(server_code)

with open('.env.example', 'r', encoding='utf-8') as f:
    env_content = f.read()

if 'G2BULK_API_KEY' not in env_content:
    env_add = """
# G2Bulk API Credentials (Optional - can also be configured via Admin Panel)
G2BULK_API_KEY=""
G2BULK_BASE_URL="https://api.g2bulk.com/v1"
G2BULK_WEBHOOK_SECRET=""
"""
    with open('.env.example', 'w', encoding='utf-8') as f:
        f.write(env_content + env_add)


# --- PHASE 5: Reorganize LootBar ---
os.makedirs('server/providers/lootbar', exist_ok=True)

lootbar_types = """export interface LootBarGame {
  gameId: string;
  name: string;
  [key: string]: any;
}

export interface LootBarSku {
  sku: string;
  name: string;
  price?: number;
  available?: boolean;
  [key: string]: any;
}
"""
with open('server/providers/lootbar/types.ts', 'w', encoding='utf-8') as f:
    f.write(lootbar_types)

if os.path.exists('server/lootbar.ts'):
    with open('server/lootbar.ts', 'r', encoding='utf-8') as f:
        lootbar_code = f.read()
    
    lootbar_code = "import { LootBarGame, LootBarSku } from './types';\n" + lootbar_code
    
    with open('server/providers/lootbar/LootBarClient.ts', 'w', encoding='utf-8') as f:
        f.write(lootbar_code)
    
    os.remove('server/lootbar.ts')

# Update imports
with open('server.ts', 'r', encoding='utf-8') as f:
    s = f.read()
s = s.replace("from './server/lootbar'", "from './server/providers/lootbar/LootBarClient'")
s = s.replace("from './lootbar'", "from './providers/lootbar/LootBarClient'")
with open('server.ts', 'w', encoding='utf-8') as f:
    f.write(s)

with open('server/bot.ts', 'r', encoding='utf-8') as f:
    b = f.read()
b = b.replace("from './lootbar'", "from './providers/lootbar/LootBarClient'")
with open('server/bot.ts', 'w', encoding='utf-8') as f:
    f.write(b)

with open('server/pricePoller.ts', 'r', encoding='utf-8') as f:
    p = f.read()
p = p.replace("from './lootbar'", "from './providers/lootbar/LootBarClient'")
with open('server/pricePoller.ts', 'w', encoding='utf-8') as f:
    f.write(p)

