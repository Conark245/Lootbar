const fs = require('fs');

let tpnService = fs.readFileSync('server/providers/topupnation/TopupNationService.ts', 'utf8');

if (!tpnService.includes('bulkToggleProductsEnabled')) {
  const insertCode = `
  public async bulkToggleProductsEnabled(productIds: string[], isEnabled: boolean): Promise<any> {
    const result = await TopupNationProduct.updateMany(
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
  tpnService = tpnService.replace('public async toggleProductEnabled', insertCode + '\n  public async toggleProductEnabled');
  fs.writeFileSync('server/providers/topupnation/TopupNationService.ts', tpnService);
}

let serverTs = fs.readFileSync('server.ts', 'utf8');
if (!serverTs.includes('/api/topupnation/products/bulk-toggle')) {
  const insertServer = `
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
`;
  serverTs = serverTs.replace('app.post("/api/topupnation/products/:productId/toggle",', insertServer + '\napp.post("/api/topupnation/products/:productId/toggle",');
  fs.writeFileSync('server.ts', serverTs);
}
