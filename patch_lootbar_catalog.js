import fs from 'fs';
let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

const originalHeader = `<h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <span>🎮</span> Select Games for Telegram Bot
            </h2>`;

const newHeader = `<h2 
              className="text-xl font-bold text-neutral-900 flex items-center gap-2 cursor-pointer select-none hover:text-emerald-700 transition-colors"
              onClick={() => setShowLootbarGames(!showLootbarGames)}
            >
              <span>🎮</span> Select Games for Telegram Bot (LootBar)
              <svg className={\`w-5 h-5 text-neutral-400 transition-transform \${showLootbarGames ? 'rotate-180' : ''}\`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </h2>`;

content = content.replace(originalHeader, newHeader);

const pDesc = `Choose which games from LootBar API should appear in your Telegram Bot. Only enabled games will be displayed in the bot's <span className="font-semibold text-neutral-700">🎮 Game List</span>.
          </p>`;

const wrapStart = `Choose which games from LootBar API should appear in your Telegram Bot. Only enabled games will be displayed in the bot's <span className="font-semibold text-neutral-700">🎮 Game List</span>.
          </p>
          {showLootbarGames && (
            <div className="mt-4">`;

content = content.replace(pDesc, wrapStart);

const lootbarEnd = `            </div>
          )}
        </div>

        {/* Telegram Users Management */}`;

const wrapEnd = `            </div>
          )}
          </div>
          )}
        </div>

        {/* Telegram Users Management */}`;

content = content.replace(lootbarEnd, wrapEnd);

fs.writeFileSync('src/App_v2.tsx', content);
