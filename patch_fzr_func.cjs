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

if (!ui.includes('const handleBulkToggleFzrProducts = async')) {
  ui = ui.replace('const handleToggleFzrProduct = async (productId: string, currentEnabled: boolean) => {', insertBulkFunctions + '\n  const handleToggleFzrProduct = async (productId: string, currentEnabled: boolean) => {');
  fs.writeFileSync('src/App_v2.tsx', ui);
  console.log('patched handleBulkToggleFzrProducts');
} else {
  console.log('Already exists');
}
