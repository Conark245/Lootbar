const fs = require('fs');
const data = JSON.parse(fs.readFileSync('fzr_openapi.json', 'utf8'));
const endpoint = data.paths['/api/v2/topups/offers'];
console.log(JSON.stringify(endpoint.get.parameters, null, 2));
