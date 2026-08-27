const fs = require('fs');

let ui = fs.readFileSync('src/App_v2.tsx', 'utf8');

const insertBulkFunctions = `
  const handleBulkToggleFzrProducts = async (isEnabled: boolean) => {
    const filtered = fzrProducts.filter(p => (p.name || "").toLowerCase().includes(fzrGameSearch.toLowerCase()));
    const productIds = filtered.map(p => p.productId);
    if (productIds.length === 0) return;
    
    if (!confirm(\`Are you sure you want to \${isEnabled ? 'enable' : 'disable'} \${productIds.length} FZR Cards products currently filtered?\`)) {
      return;
    }
    
    try {
      const res = await fetch('/api/fzrcards/products/bulk-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds, isEnabled })
      });
      const data = await res.json();
      if (data?.success) {
        setFzrProducts(prev => prev.map(p => 
          productIds.includes(p.productId) 
            ? { ...p, isEnabled, status: isEnabled ? 'ACTIVE' : 'DISABLED' } 
            : p
        ));
      } else {
        alert(data?.error || 'Failed to bulk toggle products');
      }
    } catch (err: any) {
      alert(\`Error bulk toggling products: \${err.message}\`);
    }
  };
`;

if (!ui.includes('handleBulkToggleFzrProducts')) {
  ui = ui.replace('const handleToggleFzrProduct = async (productId: string, currentEnabled: boolean) => {', insertBulkFunctions + '\n  const handleToggleFzrProduct = async (productId: string, currentEnabled: boolean) => {');
}

const targetSearchDiv = `
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search FZR Cards Games..."
                  className="px-4 py-2 border border-neutral-300 rounded-lg w-full max-w-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                  value={fzrGameSearch}
                  onChange={(e) => setFzrGameSearch(e.target.value)}
                />
              </div>
`;

const replaceSearchDiv = `
              <div className="mb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <input
                  type="text"
                  placeholder="Search FZR Cards Games..."
                  className="px-4 py-2 border border-neutral-300 rounded-lg w-full max-w-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                  value={fzrGameSearch}
                  onChange={(e) => setFzrGameSearch(e.target.value)}
                />
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleBulkToggleFzrProducts(true)}
                    className="px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 text-xs font-bold rounded-lg transition-colors"
                  >
                    Enable All Filtered
                  </button>
                  <button 
                    onClick={() => handleBulkToggleFzrProducts(false)}
                    className="px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 text-xs font-bold rounded-lg transition-colors"
                  >
                    Disable All Filtered
                  </button>
                </div>
              </div>
`;

if (ui.includes(targetSearchDiv)) {
  ui = ui.replace(targetSearchDiv, replaceSearchDiv);
  fs.writeFileSync('src/App_v2.tsx', ui);
  console.log('patched App_v2.tsx');
} else {
  console.log('Could not find search div');
}
