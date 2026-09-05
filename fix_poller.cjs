const fs = require('fs');
let code = fs.readFileSync('server/pricePoller.ts', 'utf8');
code = code.replace(/\\\`/g, '`');
code = code.replace(/\\\\\`/g, '\\`'); // if any double escaped
fs.writeFileSync('server/pricePoller.ts', code);
