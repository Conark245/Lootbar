const fs = require('fs');
let code = fs.readFileSync('src/App_v2.tsx', 'utf8');

// We want to combine savedGames and tpnProducts into one view
// Let's first look at the relevant section.
