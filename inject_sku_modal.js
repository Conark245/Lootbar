import fs from 'fs';

let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

// State for modal
const stateVars = `
  const [skuModalGame, setSkuModalGame] = useState<any>(null);
  const [skuShortKeysInput, setSkuShortKeysInput] = useState<Record<string, string>>({});
  const [savingSkuKeys, setSavingSkuKeys] = useState(false);
`;

if (!content.includes('setSkuModalGame')) {
  content = content.replace(
    'const [savedGames, setSavedGames] = useState<any[]>([]);',
    'const [savedGames, setSavedGames] = useState<any[]>([]);\n' + stateVars
  );
}

// Handler functions
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

if (!content.includes('openSkuModal')) {
  content = content.replace(
    'const fetchSavedGames = async () => {',
    handlers + '\n  const fetchSavedGames = async () => {'
  );
}

// Render Modal at the end of return
const modalJsx = `
      {/* SKU Short Keys Modal */}
      {skuModalGame && (
        <div className="fixed inset-0 bg-neutral-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden border border-neutral-200">
            <div className="px-6 py-4 border-b border-neutral-100 flex justify-between items-center bg-neutral-50/50">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Manage Package Short Keys</h3>
                <p className="text-xs text-neutral-500 mt-1">{skuModalGame.name}</p>
              </div>
              <button onClick={() => setSkuModalGame(null)} className="text-neutral-400 hover:text-neutral-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-neutral-50/30">
              <p className="text-sm text-neutral-600 mb-4">
                Assign a custom alias (short key) for each package. Users can quickly order by typing: <br/>
                <span className="font-mono bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-800">.gameKey UID packageKey</span>
              </p>
              
              <div className="space-y-3">
                {skuModalGame.isTpn 
                  ? (skuModalGame.skus || []).map((sku: any) => (
                    <div key={sku.sku} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white rounded-xl border border-neutral-200 shadow-sm">
                      <div className="flex-1">
                        <div className="font-semibold text-sm text-neutral-900">{sku.name}</div>
                        <div className="text-xs text-neutral-500 font-mono mt-0.5">Price: {sku.price} {sku.currency}</div>
                      </div>
                      <div className="w-full sm:w-48">
                        <input 
                          type="text"
                          placeholder="Short Key (e.g. 14, pass)"
                          value={skuShortKeysInput[sku.sku] || ''}
                          onChange={(e) => setSkuShortKeysInput(prev => ({ ...prev, [sku.sku]: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                          className="w-full px-3 py-1.5 text-sm font-mono border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                  ))
                  : (skuModalGame.lastKnownSkus || []).map((sku: any) => (
                    <div key={sku.sku_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white rounded-xl border border-neutral-200 shadow-sm">
                      <div className="flex-1">
                        <div className="font-semibold text-sm text-neutral-900">{sku.sku_name}</div>
                        <div className="text-xs text-neutral-500 font-mono mt-0.5">Price: $\\{sku.reseller_price}</div>
                      </div>
                      <div className="w-full sm:w-48">
                        <input 
                          type="text"
                          placeholder="Short Key (e.g. 14, pass)"
                          value={skuShortKeysInput[sku.sku_id] || ''}
                          onChange={(e) => setSkuShortKeysInput(prev => ({ ...prev, [sku.sku_id]: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                          className="w-full px-3 py-1.5 text-sm font-mono border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-neutral-100 flex justify-end gap-2 bg-white">
              <button onClick={() => setSkuModalGame(null)} className="px-4 py-2 text-sm font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveSkuShortKeys} disabled={savingSkuKeys} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-2">
                {savingSkuKeys ? 'Saving...' : 'Save Keys'}
              </button>
            </div>
          </div>
        </div>
      )}
`;

if (!content.includes('Manage Package Short Keys')) {
  // Insert modal just before the closing </div> of return
  content = content.replace(
    '      <div className="max-w-6xl mx-auto space-y-6">',
    modalJsx + '\n      <div className="max-w-6xl mx-auto space-y-6">'
  );
}

// Add the button to LB games
if (!content.includes('Manage Package Short Keys</button>')) {
  content = content.replace(
    '{/* Custom Short Key Input */}',
    '<button onClick={() => openSkuModal(saved, false)} className="w-full mb-3 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>Manage Package Short Keys</button>\n                      {/* Custom Short Key Input */}'
  );

  // Add the button to TPN products
  content = content.replace(
    '                      {/* Custom Short Key Input */}',
    '<button onClick={() => openSkuModal(p, true)} className="w-full mb-3 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>Manage Package Short Keys</button>\n                      {/* Custom Short Key Input */}'
  );
}

fs.writeFileSync('src/App_v2.tsx', content);
console.log("App_v2.tsx updated with SKU Modal correctly");
