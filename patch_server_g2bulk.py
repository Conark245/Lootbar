import re

with open('server.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Task 3: Replace unsafe startup hack
unsafe_startup = """
  // Start G2Bulk
  const g2bulkConfig = await AppConfig.findOne({ key: 'g2bulk_credentials' });
  if (g2bulkConfig?.value?.apiKey) {
    (g2bulkClient as any).apiKey = g2bulkConfig.value.apiKey;
    console.log("Loaded G2Bulk credentials from MongoDB");
  }
"""

safe_startup = """
  // Start G2Bulk
  const g2bulkConfig = await AppConfig.findOne({ key: 'g2bulk_credentials' });
  if (g2bulkConfig?.value?.apiKey) {
    g2bulkClient.updateCredentials(g2bulkConfig.value);
    console.log("Loaded G2Bulk credentials from MongoDB");
  }
"""
code = code.replace(unsafe_startup, safe_startup)

# Check if endpoints already exist to prevent duplicate insertion
if 'app.post("/api/settings/g2bulk"' not in code:
    fzr_webhook_route = """app.post("/api/webhooks/fzrcards", async (req: any, res) => {
  try {
    await fzrCardsService.handleWebhook(req.body);
    res.json({ success: true, message: "Webhook processed successfully." });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});"""

    g2bulk_endpoints = """
// ---------------------------------------------------------
// G2Bulk Provider Endpoints
// ---------------------------------------------------------

app.post("/api/settings/g2bulk", async (req, res) => {
  const { apiKey, isEnabled } = req.body;
  if (!apiKey) {
    return res.status(400).json({ error: "apiKey is required." });
  }

  try {
    const testClient = new G2BulkClient({ apiKey });
    await testClient.getBalance();

    g2bulkClient.updateCredentials({ apiKey });

    await AppConfig.findOneAndUpdate(
      { key: 'g2bulk_credentials' },
      { value: { apiKey, isEnabled: isEnabled !== false } },
      { upsert: true, returnDocument: 'after' }
    );

    res.json({ success: true, message: "G2Bulk credentials saved and verified successfully." });
  } catch (err: any) {
    res.status(401).json({ error: err.message || "Failed to authenticate with G2Bulk API." });
  }
});

app.get("/api/settings/g2bulk/status", async (req, res) => {
  try {
    const config = await AppConfig.findOne({ key: 'g2bulk_credentials' });
    res.json({
      isConfigured: g2bulkClient.isConfigured(),
      isEnabled: config?.value?.isEnabled !== false,
      webhookUrl: `${(process.env.APP_URL || "").replace(/\/$/, "")}/api/webhooks/g2bulk`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/g2bulk/balance", async (req, res) => {
  try {
    if (!g2bulkClient.isConfigured()) {
      return res.json({ success: false, balance: 0, error: "G2Bulk API is not configured." });
    }
    const balance = await g2bulkClient.getBalance();
    res.json({ success: true, balance, currency: 'USD' });
  } catch (err: any) {
    res.json({ success: false, balance: 0, error: err.message });
  }
});

app.get("/api/g2bulk/products", async (req, res) => {
  try {
    const products = await g2bulkService.getProducts();
    res.json({ success: true, products });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/g2bulk/products/sync", async (req, res) => {
  try {
    if (!g2bulkClient.isConfigured()) {
      return res.status(400).json({ error: "G2Bulk API is not configured." });
    }
    const syncResult = await g2bulkService.syncProducts();
    const products = await g2bulkService.getProducts();
    res.json({ success: true, count: syncResult.synced, total: syncResult.total, products });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/g2bulk/products/:productId/sku-shortkeys", async (req, res) => {
  try {
    const { skuShortKeys } = req.body;
    const product = await G2BulkProduct.findOneAndUpdate(
      { productId: req.params.productId },
      { skuShortKeys },
      { returnDocument: 'after' }
    );
    res.json({ success: true, product });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/g2bulk/products/:productId/shortkey", async (req, res) => {
  try {
    const { productId } = req.params;
    const { shortKey } = req.body;
    if (!shortKey) {
      return res.status(400).json({ error: "shortKey is required." });
    }
    const updated = await g2bulkService.updateProductShortKey(productId, shortKey);
    if (!updated) {
      return res.status(404).json({ error: "Product not found." });
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/g2bulk/products/bulk-toggle", async (req, res) => {
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

app.post("/api/g2bulk/products/:productId/toggle", async (req, res) => {
  try {
    const { productId } = req.params;
    const { isEnabled } = req.body;
    const updated = await g2bulkService.toggleProductEnabled(productId, isEnabled);
    if (!updated) {
      return res.status(404).json({ error: "Product not found." });
    }
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/webhooks/g2bulk", async (req: any, res) => {
  try {
    await g2bulkService.handleWebhook(req.body);
    res.json({ success: true, message: "Webhook processed successfully." });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});
"""
    code = code.replace(fzr_webhook_route, fzr_webhook_route + "\n" + g2bulk_endpoints)


with open('server.ts', 'w', encoding='utf-8') as f:
    f.write(code)

