const fs = require('fs');

let ui = fs.readFileSync('src/App_v2.tsx', 'utf8');

const insertBulkFunctions = `
  const handleBulkToggleTpnProducts = async (isEnabled: boolean) => {
    const filtered = tpnProducts.filter(p => (p.name || "").toLowerCase().includes(tpnGameSearch.toLowerCase()));
    const productIds = filtered.map(p => p.productId);
    if (productIds.length === 0) return;
    
    if (!confirm(\`Are you sure you want to \${isEnabled ? 'enable' : 'disable'} \${productIds.length} TopUpNation products currently filtered?\`)) {
      return;
    }
    
    try {
      const res = await fetch('/api/topupnation/products/bulk-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds, isEnabled })
      });
      const data = await res.json();
      if (data?.success) {
        setTpnProducts(prev => prev.map(p => 
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

if (!ui.includes('const handleBulkToggleTpnProducts = async')) {
  ui = ui.replace('const handleToggleTpnProduct = async (productId: string, currentEnabled: boolean) => {', insertBulkFunctions + '\n  const handleToggleTpnProduct = async (productId: string, currentEnabled: boolean) => {');
  fs.writeFileSync('src/App_v2.tsx', ui);
  console.log('patched handleBulkToggleTpnProducts');
} else {
  console.log('Already exists');
}
