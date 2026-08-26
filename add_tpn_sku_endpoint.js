import fs from 'fs';
let server = fs.readFileSync('server.ts', 'utf8');

const tpnEndpoint = `
app.post("/api/topupnation/products/:productId/sku-shortkeys", async (req, res) => {
  try {
    const { skuShortKeys } = req.body;
    const product = await TopupNationProduct.findOneAndUpdate(
      { productId: req.params.productId },
      { skuShortKeys: skuShortKeys },
      { new: true }
    );
    res.json({ success: true, data: product });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
`;

if (!server.includes('/sku-shortkeys')) {
  server = server.replace(
    'app.post("/api/topupnation/products/:productId/shortkey"',
    tpnEndpoint + '\napp.post("/api/topupnation/products/:productId/shortkey"'
  );
  fs.writeFileSync('server.ts', server);
  console.log("Added TPN sku-shortkeys endpoint");
}
