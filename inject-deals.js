const fs = require("fs");

const data = JSON.parse(fs.readFileSync("deals-data.json", "utf8"));
let html = fs.readFileSync("deal-stacker.html", "utf8");

// Replace PRESETS array
const presetsJson = JSON.stringify(data.deals, null, 2);
html = html.replace(
  /const PRESETS = \[[\s\S]*?\];/,
  "const PRESETS = " + presetsJson + ";"
);

// Replace week label in eyebrow — multiple possible patterns
const weekLabel = "Week of " + data.weekOf;
html = html.replace(/Week of [A-Za-z]+ \d+,? \d{4}/g, weekLabel);

// Also update the subhead date line if present
html = html.replace(
  /Updated:.*?(?=<)/g,
  "Updated: " + data.weekOf
);

// Inject updated timestamp as a data attribute on body for debugging
html = html.replace(
  /<body>/,
  "<body data-updated="" + data.updatedAt + "" data-source="" + data.source + "">"
);

fs.writeFileSync("deal-stacker.html", html);
console.log("Injected " + data.deals.length + " deals for week of " + data.weekOf);
