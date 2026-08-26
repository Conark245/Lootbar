const fs = require('fs');

const botTs = fs.readFileSync('server/bot.ts', 'utf8');
const lines = botTs.split('\n');

console.log("Total lines:", lines.length);
