import fs from 'fs';
let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

const originalHeader = `<h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <span>🌐</span> TopUpNation Products Catalog
            </h2>`;

const newHeader = `<h2 
              className="text-xl font-bold text-neutral-900 flex items-center gap-2 cursor-pointer select-none hover:text-indigo-700 transition-colors"
              onClick={() => setShowTpnGames(!showTpnGames)}
            >
              <span>🌐</span> TopUpNation Products Catalog
              <svg className={\`w-5 h-5 text-neutral-400 transition-transform \${showTpnGames ? 'rotate-180' : ''}\`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </h2>`;

content = content.replace(originalHeader, newHeader);

// Now wrap the content of TopupNation catalog
// The content starts after the `<p>` description
const pDesc = `Synced products from TopupNation. Set custom Short Keys for rapid ordering in Telegram (e.g. <span className="font-mono font-semibold text-neutral-800">.tp</span> or <span className="font-mono font-semibold text-neutral-800">.tml</span>).
          </p>`;

const wrapStart = `Synced products from TopupNation. Set custom Short Keys for rapid ordering in Telegram (e.g. <span className="font-mono font-semibold text-neutral-800">.tp</span> or <span className="font-mono font-semibold text-neutral-800">.tml</span>).
          </p>
          {showTpnGames && (
            <div className="mt-4">`;

content = content.replace(pDesc, wrapStart);

// It ends before `{/* Telegram Bot Games Management */}`
const tpnEnd = `            </div>
          )}
        </div>

        {/* Telegram Bot Games Management */}`;

const wrapEnd = `            </div>
          )}
          </div>
          )}
        </div>

        {/* Telegram Bot Games Management */}`;

content = content.replace(tpnEnd, wrapEnd);

fs.writeFileSync('src/App_v2.tsx', content);
