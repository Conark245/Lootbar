const fs = require('fs');

let fzrService = fs.readFileSync('server/providers/fzrcards/FzrCardsService.ts', 'utf8');

if (!fzrService.includes('bulkToggleProductsEnabled')) {
  const insertCode = `
  public async bulkToggleProductsEnabled(productIds: string[], isEnabled: boolean): Promise<any> {
    const result = await FzrCardsProduct.updateMany(
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
  fzrService = fzrService.replace('public async toggleProductEnabled', insertCode + '\n  public async toggleProductEnabled');
  fs.writeFileSync('server/providers/fzrcards/FzrCardsService.ts', fzrService);
  console.log('patched FzrCardsService');
}

let serverTs = fs.readFileSync('server.ts', 'utf8');
if (!serverTs.includes('/api/fzrcards/products/bulk-toggle')) {
  const insertServer = `
app.post("/api/fzrcards/products/bulk-toggle", async (req, res) => {
  try {
    const { productIds, isEnabled } = req.body;
    if (!Array.isArray(productIds)) {
      return res.status(400).json({ error: "productIds array is required." });
    }
    const result = await fzrCardsService.bulkToggleProductsEnabled(productIds, isEnabled);
    res.json({ success: true, count: result.modifiedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
`;
  serverTs = serverTs.replace('app.post("/api/fzrcards/products/:productId/toggle",', insertServer + '\napp.post("/api/fzrcards/products/:productId/toggle",');
  fs.writeFileSync('server.ts', serverTs);
  console.log('patched server.ts');
}
