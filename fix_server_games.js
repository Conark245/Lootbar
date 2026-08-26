import fs from 'fs';
let server = fs.readFileSync('server.ts', 'utf8');

server = server.replace(
  'const { shortKey, name } = req.body;',
  'const { shortKey, name, skuShortKeys } = req.body;'
);

server = server.replace(
  'if (name) updateData.name = name;',
  'if (name) updateData.name = name;\n    if (skuShortKeys !== undefined) updateData.skuShortKeys = skuShortKeys;'
);

fs.writeFileSync('server.ts', server);
console.log("server.ts updated for saved-games");
