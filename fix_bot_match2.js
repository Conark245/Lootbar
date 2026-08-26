import fs from 'fs';

let bot = fs.readFileSync('server/bot.ts', 'utf8');

// The original lines were duplicated:
// function findTopupNationSkuMatch...
//   if (!rawQuery || !skus || skus.length === 0) return null;
//   const query = rawQuery.trim().toLowerCase();
//
//   if (skuShortKeys) { ... }
//   if (!rawQuery || !skus || skus.length === 0) return null;
//   const query = rawQuery.trim().toLowerCase();

bot = bot.replace(
  `  if (!rawQuery || !skus || skus.length === 0) return null;\n  const query = rawQuery.trim().toLowerCase();\n  \n  if (skuShortKeys) {`,
  `  if (skuShortKeys) {`
);

// Do the same for findSkuMatch
bot = bot.replace(
  `  if (!rawQuery || !skus || skus.length === 0) return null;\n  const query = rawQuery.trim().toLowerCase();\n  \n  if (skuShortKeys) {`,
  `  if (skuShortKeys) {`
);

fs.writeFileSync('server/bot.ts', bot);
console.log("bot.ts duplication fixed");
