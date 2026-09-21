const fs = require('fs');
const content = fs.readFileSync('src/App_v2.tsx', 'utf-8');
console.log(content.substring(2620, 2690)); // Just a random check
