// Reads deals-data.json and injects fresh presets into deal-stacker.html
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('deals-data.json', 'utf8'));
let html = fs.readFileSync('deal-stacker.html', 'utf8');

// Replace the PRESETS array and week label
const presetsJson = JSON.stringify(data.deals, null, 2);
html = html.replace(
  /const PRESETS = \[[\s\S]*?\];/,
  `const PRESETS = ${presetsJson};`
);
html = html.replace(
  /Week of [^<"]+/g,
  `Week of ${data.weekOf}`
);

fs.writeFileSync('deal-stacker.html', html);
console.log(`Injected ${data.deals.length} deals for week of ${data.weekOf}`);
