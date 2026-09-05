const fs = require('fs');
let code = fs.readFileSync('server/pricePoller.ts', 'utf8');

code = code.replace(
  /const message = .*?_Note: The Bot has already updated its prices automatically\. You will see these new prices when placing an order\._`;/s,
  `const gameSafeName = gameName.replace(/[*_\`\\[\\]]/g, '');
    const message = \`📈 *Price Update Alert* (\${provider})\\n🎮 Game: *\${gameSafeName}* (\\\`.\${shortKey}\\\`)\\n\\nThe following packages have been added or updated:\\n\${changes.join('\\n')}\\n\\n_Note: The Bot has already updated its prices automatically. You will see these new prices when placing an order._\`;`
);

fs.writeFileSync('server/pricePoller.ts', code);
