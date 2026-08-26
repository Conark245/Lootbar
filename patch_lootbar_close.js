import fs from 'fs';
let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

const target = `            </div>
          )}
        </div>

        {/* Active Games in Telegram Bot & Short Key Settings */}`;

const replacement = `            </div>
          )}
          </div>
          )}
        </div>

        {/* Active Games in Telegram Bot & Short Key Settings */}`;

content = content.replace(target, replacement);

fs.writeFileSync('src/App_v2.tsx', content);
