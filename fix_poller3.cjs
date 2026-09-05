const fs = require('fs');
let code = fs.readFileSync('server/pricePoller.ts', 'utf8');

code = code.replace(
  /const newGameNames = newLiveProducts\.map\(\(p: any\) => `• 🎮 \*\${\(p\.name \|\| 'Game'\)\.replace\(\/\[\*_`\\\[\\\]\]\/g, ''\)}\*`\);/g,
  `const newGameNames = newLiveProducts.map((p: any) => \`• 🎮 *\${(p.name || 'Game').replace(/[*_\`\\[\\]]/g, '')}*\`);`
);

fs.writeFileSync('server/pricePoller.ts', code);
