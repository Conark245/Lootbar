import fs from 'fs';
const content = fs.readFileSync('src/App_v2.tsx', 'utf8');
const match = content.match(/const filteredOrders = orders\.filter[\s\S]*?\n\s+return \(/);
if (match) {
  console.log(match[0]);
} else {
  console.log("NOT FOUND");
}
