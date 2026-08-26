import fs from 'fs';

let content = fs.readFileSync('server/bot/helpers.ts', 'utf8');

content = content.replace(/\\\\\$/g, '\\$');
content = content.replace(/\\[\\]/g, '\\]');
content = content.replace(/\\\\\\]/g, '\\]');
content = content.replace(/\\[`\\\\\\\\]/g, '[`\\\\]');

fs.writeFileSync('server/bot/helpers.ts', content);
