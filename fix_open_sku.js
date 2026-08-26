import fs from 'fs';

let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

const handlers = `
  const openSkuModal = (game: any, isTpn: boolean) => {
    setSkuModalGame({ ...game, isTpn });
    setSkuShortKeysInput(game.skuShortKeys || {});
  };

  const handleSaveSkuShortKeys = async () => {
    if (!skuModalGame) return;
    setSavingSkuKeys(true);
    try {
      if (skuModalGame.isTpn) {
        const res = await fetch(\`/api/topupnation/products/\${skuModalGame.productId}/sku-shortkeys\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skuShortKeys: skuShortKeysInput })
        });
        if (res.ok) {
          fetchTpnProducts();
          setSkuModalGame(null);
        }
      } else {
        const res = await fetch(\`/api/saved-games/\${skuModalGame.gameId}\`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skuShortKeys: skuShortKeysInput })
        });
        if (res.ok) {
          fetchSavedGames();
          setSkuModalGame(null);
        }
      }
    } catch (err: any) {
      alert('Error saving SKU keys: ' + err.message);
    } finally {
      setSavingSkuKeys(false);
    }
  };
`;

if (!content.includes('openSkuModal = (game:')) {
  content = content.replace(
    'const fetchSavedGames = () => {',
    handlers + '\n  const fetchSavedGames = () => {'
  );
  fs.writeFileSync('src/App_v2.tsx', content);
  console.log("App_v2.tsx updated with handlers");
} else {
  console.log("Handlers already exist");
}
