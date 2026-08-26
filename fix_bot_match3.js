import fs from 'fs';

let bot = fs.readFileSync('server/bot.ts', 'utf8');

// The original lines were duplicated:
// function findTopupNationSkuMatch(skus: any[], rawQuery: string, skuShortKeys?: Record<string, string>): any {
//   if (skuShortKeys) {
//     for (const [skuId, shortKey] of Object.entries(skuShortKeys)) {
//       if (shortKey.toLowerCase() === query) {

bot = bot.replace(
  `  if (skuShortKeys) {`,
  `  if (!rawQuery || !skus || skus.length === 0) return null;\n  const query = rawQuery.trim().toLowerCase();\n\n  if (skuShortKeys) {`
);

bot = bot.replace(
  `  if (!rawQuery || !skus || skus.length === 0) return null;\n  const query = rawQuery.trim().toLowerCase();\n  const cleanQuery = query.replace(/uc|diamond|diamonds|dm|gem|gems|credits|cp/g, '').trim();`,
  `  const cleanQuery = query.replace(/uc|diamond|diamonds|dm|gem|gems|credits|cp/g, '').trim();`
);

fs.writeFileSync('server/bot.ts', bot);
console.log("bot.ts duplication fixed 3");
