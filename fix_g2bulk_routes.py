import re

with open('server.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Add routes before app.listen or similar end of file
new_routes = """
// ==========================================
// G2Bulk Admin API Endpoints
// ==========================================

app.get('/api/settings/g2bulk/status', async (req, res) => {
  try {
    const config = await AppConfig.findOne({ key: 'g2bulk_credentials' });
    res.json({
      success: true,
      configured: !!config?.value?.apiKey,
      apiKey: config?.value?.apiKey || '',
      isEnabled: config?.value?.isEnabled !== false
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/g2bulk', async (req, res) => {
  try {
    const { apiKey, isEnabled } = req.body;
    g2bulkClient.updateCredentials({ apiKey });
    
    // Test the API key
    if (apiKey) {
        const testRes = await g2bulkClient.getBalance();
        if (!testRes.success) {
             return res.json({ success: false, error: 'Invalid API Key or API error' });
        }
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

app.post('/api/g2bulk/products/:productId/shortkey', async (req, res) => {
  try {
    const { shortKey } = req.body;
    await G2BulkProduct.findOneAndUpdate(
      { productId: req.params.productId },
      { shortKey }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/g2bulk/products/:productId/sku-shortkeys', async (req, res) => {
  try {
    const { skuShortKeys } = req.body;
    await G2BulkProduct.findOneAndUpdate(
      { productId: req.params.productId },
      { skuShortKeys }
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

"""

# Insert right before the last "if (process.env.NODE_ENV !== 'production')"
content = content.replace("if (process.env.NODE_ENV !== 'production')", new_routes + "\nif (process.env.NODE_ENV !== 'production')")

with open('server.ts', 'w', encoding='utf-8') as f:
    f.write(content)
