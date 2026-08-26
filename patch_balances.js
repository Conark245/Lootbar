import fs from 'fs';
let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

const target = `<p className="text-sm text-neutral-500 mt-1">
                Real-time tracking of top-ups syncing automatically with LootBar & Game APIs
              </p>
            </div>`;

const replacement = `<p className="text-sm text-neutral-500 mt-1">
                Real-time tracking of top-ups syncing automatically with LootBar & Game APIs
              </p>
            </div>

            {/* LIVE API BALANCES IN ORDER HISTORY */}
            <div className="flex gap-4">
              {lootbarBalance && (
                <div className="flex flex-col px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">LootBar Balance</span>
                  <span className="text-lg font-mono font-extrabold text-emerald-900">\${lootbarBalance.total_amount || lootbarBalance.balance || '0.00'}</span>
                </div>
              )}
              {tpnBalance && (
                <div className="flex flex-col px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
                  <span className="text-[10px] uppercase font-bold text-indigo-700 tracking-wider">TopupNation Balance</span>
                  <span className="text-lg font-mono font-extrabold text-indigo-900">\${Number(tpnBalance.balance || 0).toFixed(2)}</span>
                </div>
              )}
            </div>`;

content = content.replace(target, replacement);
fs.writeFileSync('src/App_v2.tsx', content);
