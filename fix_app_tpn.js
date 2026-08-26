import fs from 'fs';
let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

// Fix updateTpnProduct
content = content.replace(
  'onClick={() => updateTpnProduct(p.productId, { shortKey: currentInput })}',
  'onClick={() => handleSaveTpnShortKey(p.productId)}'
);

// Fix toggleTpnProduct
content = content.replace(
  'onClick={() => toggleTpnProduct(p.productId, false)}',
  'onClick={() => handleToggleTpnProduct(p.productId, true)}'
);

fs.writeFileSync('src/App_v2.tsx', content);
console.log("App_v2.tsx fixed");
