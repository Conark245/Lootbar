const fs = require('fs');

let lbService = fs.readFileSync('server/providers/lootbar/LootbarService.ts', 'utf8');

if (!lbService.includes('bulkToggleProductsEnabled')) {
  const insertCode = `
  public async bulkToggleProductsEnabled(productIds: string[], isEnabled: boolean): Promise<any> {
    const result = await LootbarProduct.updateMany(
      { productId: { $in: productIds } },
      { 
        $set: { 
          isEnabled: isEnabled,
          status: isEnabled ? 'ACTIVE' : 'DISABLED'
        }
      }
    );
    return result;
  }
`;
  lbService = lbService.replace('public async toggleProductEnabled', insertCode + '\n  public async toggleProductEnabled');
  fs.writeFileSync('server/providers/lootbar/LootbarService.ts', lbService);
}

let serverTs = fs.readFileSync('server.ts', 'utf8');
if (!serverTs.includes('/api/lootbar/products/bulk-toggle')) {
  const insertServer = `
app.post("/api/lootbar/products/bulk-toggle", async (req, res) => {
  try {
    const { productIds, isEnabled } = req.body;
    if (!Array.isArray(productIds)) {
      return res.status(400).json({ error: "productIds array is required." });
    }
    const result = await lootbarService.bulkToggleProductsEnabled(productIds, isEnabled);
    res.json({ success: true, count: result.modifiedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
`;
  serverTs = serverTs.replace('app.post("/api/lootbar/products/:productId/toggle",', insertServer + '\napp.post("/api/lootbar/products/:productId/toggle",');
  fs.writeFileSync('server.ts', serverTs);
}
