import fs from 'fs';

// 1. SavedGame.ts
let sg = fs.readFileSync('server/models/SavedGame.ts', 'utf8');
if (!sg.includes('skuShortKeys')) {
  sg = sg.replace('lastKnownSkus?: any[];', 'lastKnownSkus?: any[];\n  skuShortKeys?: Record<string, string>;');
  sg = sg.replace('lastKnownSkus: { type: Array, default: [] }', 'lastKnownSkus: { type: Array, default: [] },\n  skuShortKeys: { type: Map, of: String, default: {} }');
  fs.writeFileSync('server/models/SavedGame.ts', sg);
  console.log("SavedGame.ts updated");
}

// 2. TopupNationProduct.ts
let tpn = fs.readFileSync('server/models/TopupNationProduct.ts', 'utf8');
if (!tpn.includes('skuShortKeys')) {
  tpn = tpn.replace('shortKey?: string;', 'shortKey?: string;\n  skuShortKeys?: Record<string, string>;');
  tpn = tpn.replace('shortKey: { type: String, trim: true, lowercase: true },', 'shortKey: { type: String, trim: true, lowercase: true },\n  skuShortKeys: { type: Map, of: String, default: {} },');
  fs.writeFileSync('server/models/TopupNationProduct.ts', tpn);
  console.log("TopupNationProduct.ts updated");
}
