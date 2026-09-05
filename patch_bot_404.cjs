const fs = require('fs');
let bot = fs.readFileSync('server/bot.ts', 'utf8');

bot = bot.replace(
  "console.error('Error syncing TPN product live:', err);",
  "if (err?.status === 404 || err?.code === 'PRODUCT_NOT_FOUND' || err?.responseData?.error?.code === 'PRODUCT_NOT_FOUND') {\n        console.warn(`[TopupNation] Product ${product.productId} not found on live sync. Disabling locally.`);\n        product.isEnabled = false;\n        product.status = 'DISABLED';\n        await product.save().catch(() => {});\n      } else {\n        console.error('Error syncing TPN product live:', err.message || err);\n      }"
);

fs.writeFileSync('server/bot.ts', bot);
console.log("Patched 404 handling in syncTopupNationProductLive");

let poller = fs.readFileSync('server/pricePoller.ts', 'utf8');
poller = poller.replace(
  "// Skip silently",
  "// Handle 404 to disable product\n      if (err?.status === 404 || err?.code === 'PRODUCT_NOT_FOUND' || err?.responseData?.error?.code === 'PRODUCT_NOT_FOUND') {\n        console.warn(`[TopupNation Poller] Product not found, skipping.`);\n      }\n      console.error('Error in checkTopupNationPrices:', err.message || err);"
);
fs.writeFileSync('server/pricePoller.ts', poller);

