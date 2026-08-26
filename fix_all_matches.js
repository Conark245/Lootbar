import fs from 'fs';

let bot = fs.readFileSync('server/bot.ts', 'utf8');

const regexLootbar = /function findLootBarSkuMatch[\s\S]*?(?=function findTopupNationSkuMatch)/;
const regexTpn = /function findTopupNationSkuMatch[\s\S]*?(?=\/\/ Direct order placement using Owner-defined Short Key)/;

const newLootbar = `function findLootBarSkuMatch(skus: any[], rawQuery: string, skuShortKeys?: Record<string, string>): any {
  if (!rawQuery || !skus || skus.length === 0) return null;
  const query = rawQuery.trim().toLowerCase();
  
  if (skuShortKeys) {
    for (const [skuId, shortKey] of Object.entries(skuShortKeys)) {
      if (shortKey.toLowerCase() === query) {
        const match = skus.find(s => String(s.sku_id) === skuId);
        if (match) return match;
      }
    }
  }

  const cleanQuery = query.replace(/uc|diamond|diamonds|dm|gem|gems|credits|cp/g, '').trim();

  // 1. Exact SKU ID match
  const exactId = skus.find((s: any) => String(s.sku_id).toLowerCase() === query);
  if (exactId) return exactId;

  // 2. Exact name match
  const exactName = skus.find((s: any) => (s.sku_name || '').toLowerCase().trim() === query);
  if (exactName) return exactName;

  // 3. Exact alias mappings
  if (query === 'wp' || query === 'wdp' || query === 'weekly' || query === 'pass' || query === 'weekly pass' || query === 'weeklypass') {
    const wdp = skus.find((s: any) => /weekly/i.test(s.sku_name || '') || /wdp/i.test(s.sku_name || '') || /pass/i.test(s.sku_name || ''));
    if (wdp) return wdp;
  }
  if (query === 'tp' || query === 'twilight' || query === 'twilight pass' || query === 'twilightpass') {
    const tp = skus.find((s: any) => /twilight/i.test(s.sku_name || ''));
    if (tp) return tp;
  }
  if (query === 'monthly' || query === 'monthly pass' || query === 'monthlypass') {
    const monthly = skus.find((s: any) => /monthly/i.test(s.sku_name || ''));
    if (monthly) return monthly;
  }

  // 4. Number match (e.g. user typed "60" or "86" or "100" or "14")
  const queryNumbers = cleanQuery.match(/\\d+/g) || query.match(/\\d+/g);
  if (queryNumbers && queryNumbers.length > 0) {
    const targetNum = queryNumbers[0];
    
    // 4.1 Prioritize item starting with target number (e.g. "14 Diamonds" or "14 Diamonds (13+1)")
    const leadingNumMatch = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase().trim();
      return name.startsWith(targetNum + ' ') || name.startsWith(targetNum + 'd') || name.startsWith(targetNum + '(');
    });
    if (leadingNumMatch) return leadingNumMatch;

    // 4.2 Exact word boundary
    const exactWordNum = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase();
      const numRegex = new RegExp(\`\\\\b\${targetNum}\\\\b\`);
      return numRegex.test(name);
    });
    if (exactWordNum) return exactWordNum;

    // 4.3 Any numeric match
    const anyNumMatch = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase();
      const nameNumbers = name.match(/\\d+/g);
      return nameNumbers && nameNumbers.includes(targetNum);
    });
    if (anyNumMatch) return anyNumMatch;
  }

  // 5. Multi-word tokens match (all words in user query appear in sku_name)
  const tokens = query.split(/\\s+/).filter(t => t.length > 0);
  if (tokens.length > 1) {
    const tokenMatch = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase();
      return tokens.every(t => name.includes(t));
    });
    if (tokenMatch) return tokenMatch;
  }

  // 6. Substring match
  const subMatch = skus.find((s: any) => 
    (s.sku_name || '').toLowerCase().includes(query) || 
    (cleanQuery && (s.sku_name || '').toLowerCase().includes(cleanQuery))
  );
  if (subMatch) return subMatch;

  return null;
}

`;

const newTpn = `function findTopupNationSkuMatch(skus: any[], rawQuery: string, skuShortKeys?: Record<string, string>): any {
  if (!rawQuery || !skus || skus.length === 0) return null;
  const query = rawQuery.trim().toLowerCase();
  
  if (skuShortKeys) {
    for (const [skuId, shortKey] of Object.entries(skuShortKeys)) {
      if (shortKey.toLowerCase() === query) {
        const match = skus.find(s => String(s.sku) === skuId);
        if (match) return match;
      }
    }
  }

  const cleanQuery = query.replace(/uc|diamond|diamonds|dm|gem|gems|credits|cp/g, '').trim();

  // 1. Exact SKU ID match
  const exactId = skus.find((s: any) => String(s.sku).toLowerCase() === query);
  if (exactId) return exactId;

  // 2. Exact name match
  const exactName = skus.find((s: any) => (s.name || '').toLowerCase().trim() === query);
  if (exactName) return exactName;

  // 3. Exact alias mappings (Weekly Pass, Twilight Pass, Monthly)
  if (query === 'wp' || query === 'wdp' || query === 'weekly' || query === 'pass' || query === 'weekly pass' || query === 'weeklypass') {
    const weekly = skus.find((s: any) => /weekly/i.test(s.name || ''));
    if (weekly) return weekly;
  }
  if (query === 'tp' || query === 'twilight' || query === 'twilight pass' || query === 'twilightpass') {
    const twilight = skus.find((s: any) => /twilight/i.test(s.name || ''));
    if (twilight) return twilight;
  }
  if (query === 'monthly' || query === 'monthly pass' || query === 'monthlypass') {
    const monthly = skus.find((s: any) => /monthly/i.test(s.name || ''));
    if (monthly) return monthly;
  }

  // 4. Number match (e.g. user typed "14", "42", "86", "100")
  const queryNumbers = cleanQuery.match(/\\d+/g) || query.match(/\\d+/g);
  if (queryNumbers && queryNumbers.length > 0) {
    const targetNum = queryNumbers[0];

    // 4.1 Prioritize item starting with target number (e.g. "14 Diamonds" or "14 Diamonds (13+1)")
    const leadingNumMatch = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase().trim();
      return name.startsWith(targetNum + ' ') || name.startsWith(targetNum + 'd') || name.startsWith(targetNum + '(');
    });
    if (leadingNumMatch) return leadingNumMatch;

    // 4.2 Exact word boundary
    const exactWordNum = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase();
      const numRegex = new RegExp(\`\\\\b\${targetNum}\\\\b\`);
      return numRegex.test(name);
    });
    if (exactWordNum) return exactWordNum;

    // 4.3 Any numeric match
    const anyNumMatch = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase();
      const nameNumbers = name.match(/\\d+/g);
      return nameNumbers && nameNumbers.includes(targetNum);
    });
    if (anyNumMatch) return anyNumMatch;
  }

  // 5. Multi-word tokens match
  const tokens = query.split(/\\s+/).filter(t => t.length > 0);
  if (tokens.length > 1) {
    const tokenMatch = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase();
      return tokens.every(t => name.includes(t));
    });
    if (tokenMatch) return tokenMatch;
  }

  // 6. Substring match
  const subMatch = skus.find((s: any) => 
    (s.name || '').toLowerCase().includes(query) || 
    (cleanQuery && (s.name || '').toLowerCase().includes(cleanQuery))
  );
  if (subMatch) return subMatch;

  return null;
}

`;

bot = bot.replace(regexLootbar, newLootbar);
bot = bot.replace(regexTpn, newTpn);

fs.writeFileSync('server/bot.ts', bot);
console.log("Functions perfectly rewritten.");

