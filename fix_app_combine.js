const fs = require('fs');

const path = 'src/App_v2.tsx';
let content = fs.readFileSync(path, 'utf8');

// The active games section is from line 1261
// We can modify the map to also map over enabled tpnProducts
