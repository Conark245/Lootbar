const fs = require('fs');
let helpers = fs.readFileSync('server/bot/helpers.ts', 'utf8');

helpers = helpers.replace(
  "    console.error('[Bot Error] safeEditMessageCaption failed:', err.message);\n    if (err.description && err.description.includes('message is not modified')) {\n      return null;\n    }",
  "    if (err.description && err.description.includes('message is not modified')) {\n      return null;\n    }\n    console.error('[Bot Error] safeEditMessageCaption failed:', err.message);"
);

fs.writeFileSync('server/bot/helpers.ts', helpers);
