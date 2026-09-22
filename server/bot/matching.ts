export function findLootBarSkuMatch(skus: any[], rawQuery: string, skuShortKeys?: Record<string, string>): any {
  if (!rawQuery || !skus || skus.length === 0) return null;
  const query = rawQuery.trim().toLowerCase();
  
  if (skuShortKeys) {
    for (const [skuId, shortKey] of Object.entries(skuShortKeys)) {
      if (shortKey && String(shortKey).trim().toLowerCase() === query) {
        const match = skus.find(s => String(s.sku_id || s.sku) === String(skuId));
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
  const queryNumbers = cleanQuery.match(/\d+/g) || query.match(/\d+/g);
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
      const numRegex = new RegExp(`\\b${targetNum}\\b`);
      return numRegex.test(name);
    });
    if (exactWordNum) return exactWordNum;

    // 4.3 Any numeric match
    const anyNumMatch = skus.find((s: any) => {
      const name = (s.sku_name || '').toLowerCase();
      const nameNumbers = name.match(/\d+/g);
      return nameNumbers && nameNumbers.includes(targetNum);
    });
    if (anyNumMatch) return anyNumMatch;
  }

  // 5. Multi-word tokens match (all words in user query appear in sku_name)
  const tokens = query.split(/\s+/).filter(t => t.length > 0);
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

export function findTopupNationSkuMatch(skus: any[], rawQuery: string, skuShortKeys?: Record<string, string>): any {
  if (!rawQuery || !skus || skus.length === 0) return null;
  const query = rawQuery.trim().toLowerCase();
  
  if (skuShortKeys) {
    for (const [skuId, shortKey] of Object.entries(skuShortKeys)) {
      if (shortKey && String(shortKey).trim().toLowerCase() === query) {
        const match = skus.find(s => String(s.sku || s.sku_id) === String(skuId));
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
  const queryNumbers = cleanQuery.match(/\d+/g) || query.match(/\d+/g);
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
      const numRegex = new RegExp(`\\b${targetNum}\\b`);
      return numRegex.test(name);
    });
    if (exactWordNum) return exactWordNum;

    // 4.3 Any numeric match
    const anyNumMatch = skus.find((s: any) => {
      const name = (s.name || '').toLowerCase();
      const nameNumbers = name.match(/\d+/g);
      return nameNumbers && nameNumbers.includes(targetNum);
    });
    if (anyNumMatch) return anyNumMatch;
  }

  // 5. Multi-word tokens match
  const tokens = query.split(/\s+/).filter(t => t.length > 0);
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

export const findG2BulkSkuMatch = findTopupNationSkuMatch;

export interface ParsedSkuResult {
  sku: any | null;
  quantity: number;
  productQuery: string;
}

export function parseSkuWithQuantity(
  skus: any[],
  rawQuery: string,
  skuShortKeys?: Record<string, string>,
  isTopupNation: boolean = false
): ParsedSkuResult {
  if (!rawQuery || !skus || skus.length === 0) {
    return { sku: null, quantity: 1, productQuery: '' };
  }

  let cleanedQuery = rawQuery.trim();
  let quantity = 1;

  // 1. Check for explicit multipliers/quantity markers at the end of the query:
  // e.g., "x5", "x 5", "*5", "* 5", "5x", "5 x", "qty:5", "qty 5", "count:5", "count 5", "5pcs", "5 pcs", "5 times"
  const explicitQtyRegex = /(?:(?:\*|x|qty:?|count:?)\s*(\d+)|\b(\d+)\s*(?:x|pcs|times))\s*$/i;
  const explicitMatch = cleanedQuery.match(explicitQtyRegex);

  if (explicitMatch) {
    const matchedQty = explicitMatch[1] || explicitMatch[2];
    quantity = parseInt(matchedQty, 10) || 1;
    cleanedQuery = cleanedQuery.replace(explicitQtyRegex, '').trim();
  } else {
    // 2. Check for trailing standalone number when query has multiple tokens
    // e.g. user typed ".ml 12345 2001 86 5" -> query is "86 5"
    // e.g. ".mc 1169626707 13731 one time 3" -> query is "one time 3"
    // e.g. ".ml 12345 2001 wp 2" -> query is "wp 2"
    const tokens = cleanedQuery.split(/\s+/);
    if (tokens.length >= 2) {
      const lastToken = tokens[tokens.length - 1];
      if (/^\d+$/.test(lastToken)) {
        const potentialQty = parseInt(lastToken, 10);
        if (potentialQty >= 1 && potentialQty <= 100) {
          const prefixQuery = tokens.slice(0, -1).join(' ').trim();
          const matchWithPrefix = isTopupNation 
            ? findTopupNationSkuMatch(skus, prefixQuery, skuShortKeys)
            : findLootBarSkuMatch(skus, prefixQuery, skuShortKeys);
          
          if (matchWithPrefix) {
            return {
              sku: matchWithPrefix,
              quantity: Math.max(1, Math.min(100, potentialQty)),
              productQuery: prefixQuery
            };
          }
        }
      }
    }
  }

  quantity = Math.max(1, Math.min(100, quantity));

  const matchedSku = isTopupNation
    ? findTopupNationSkuMatch(skus, cleanedQuery, skuShortKeys)
    : findLootBarSkuMatch(skus, cleanedQuery, skuShortKeys);

  return {
    sku: matchedSku,
    quantity,
    productQuery: cleanedQuery
  };
}

