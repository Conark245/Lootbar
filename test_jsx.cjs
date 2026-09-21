const fs = require('fs');

const content = fs.readFileSync('src/App_v2.tsx', 'utf-8');

// Simple counter for tags inside the main return block
const startIdx = content.indexOf('return (');
if (startIdx === -1) {
    console.log("no return ( found");
    process.exit(1);
}

let openTags = 0;
let closeTags = 0;

const regex = /<\/?([a-zA-Z0-9_]+)(>|[^>]*?>)/g;
let match;
while ((match = regex.exec(content.substring(startIdx))) !== null) {
    const tagFull = match[0];
    const tagName = match[1];
    
    // Ignore self-closing tags
    if (tagFull.endsWith('/>')) {
        continue;
    }
    
    // Ignore single tags that don't need closing in this basic check
    if (['input', 'img', 'br', 'hr', 'path', 'svg'].includes(tagName.toLowerCase())) {
         if (tagName.toLowerCase() === 'svg') {
             // SVG might have closing tag, we should handle it.
         } else {
             // continue;
         }
    }
    
    if (tagFull.startsWith('</')) {
        closeTags++;
    } else {
        openTags++;
    }
}

console.log(`Open: ${openTags}, Close: ${closeTags}`);
