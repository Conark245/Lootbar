const fs = require('fs');
const clientPath = 'server/providers/topupnation/TopupNationClient.ts';
let client = fs.readFileSync(clientPath, 'utf8');

client = client.replace(
  "const apiError = error.response?.data?.error || error.response?.data?.message || error.response?.data?.code;",
  "let apiError = error.response?.data?.error || error.response?.data?.message || error.response?.data?.code;\n      if (typeof apiError === 'object' && apiError !== null) {\n        apiError = apiError.code || apiError.message || JSON.stringify(apiError);\n      }"
);

fs.writeFileSync(clientPath, client);
console.log("Patched error parsing");
