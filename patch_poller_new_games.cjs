const fs = require('fs');
let poller = fs.readFileSync('server/pricePoller.ts', 'utf8');

// TPN New Games
const tpnNewGamesLogic = `
      // Detect brand new games
      const allDbProducts = await TopupNationProduct.find({});
      const newLiveProducts = liveProducts.filter((live: any) => !allDbProducts.find(p => String(p.productId) === String(live.productId)));
      
      if (newLiveProducts.length > 0 && this.telegramNotifier) {
        const newGameNames = newLiveProducts.map((p: any) => \`• 🎮 *\${(p.name || 'Game').replace(/[*_\`\\[\\]]/g, '')}*\`);
        const msg = \`🌟 *New Games Available on TopupNation!*\\n\\nThe following games were just added to the API:\\n\${newGameNames.slice(0, 30).join('\\n')}\${newGameNames.length > 30 ? '\\n...and more' : ''}\\n\\n_Note: They have been automatically synced to the database. Configure them in Admin Panel._\`;
        const users = await User.find({ isAuthorized: true });
        for (const u of users) {
           await this.telegramNotifier(u.telegramChatId, msg);
           await new Promise(r => setTimeout(r, 50));
        }
        await this.topupNationService.syncCatalog(); // Auto sync them to DB so we don't notify again
      }
`;

poller = poller.replace(
  "const liveProducts = await tpnClient.getProducts();\n      \n      const enabledProducts = await TopupNationProduct.find({ isEnabled: { $ne: false } });",
  "const liveProducts = await tpnClient.getProducts();" + tpnNewGamesLogic + "\n      const enabledProducts = await TopupNationProduct.find({ isEnabled: { $ne: false } });"
);


// FZR New Games
const fzrNewGamesLogic = `
      // Detect brand new games
      const allDbProducts = await FzrCardsProduct.find({});
      const newLiveProducts = liveProducts.filter((live: any) => !allDbProducts.find(p => String(p.productId) === String(live.productId)));
      
      if (newLiveProducts.length > 0 && this.telegramNotifier) {
        const newGameNames = newLiveProducts.map((p: any) => \`• 🎮 *\${(p.name || 'Game').replace(/[*_\`\\[\\]]/g, '')}*\`);
        const msg = \`🌟 *New Games Available on FZR Cards!*\\n\\nThe following games were just added to the API:\\n\${newGameNames.slice(0, 30).join('\\n')}\${newGameNames.length > 30 ? '\\n...and more' : ''}\\n\\n_Note: They have been automatically synced to the database. Configure them in Admin Panel._\`;
        const users = await User.find({ isAuthorized: true });
        for (const u of users) {
           await this.telegramNotifier(u.telegramChatId, msg);
           await new Promise(r => setTimeout(r, 50));
        }
        await this.fzrCardsService?.syncCatalog(); // Auto sync them to DB so we don't notify again
      }
`;

poller = poller.replace(
  "const liveProducts = await fzrClient.getProducts();\n      const enabledProducts = await FzrCardsProduct.find({ isEnabled: { $ne: false } });",
  "const liveProducts = await fzrClient.getProducts();\n" + fzrNewGamesLogic + "\n      const enabledProducts = await FzrCardsProduct.find({ isEnabled: { $ne: false } });"
);


fs.writeFileSync('server/pricePoller.ts', poller);
console.log("Patched New Games");
