const fs = require('fs');

try {
  const data = JSON.parse(fs.readFileSync('deals-data.json', 'utf8'));
  let html = fs.readFileSync('deal-stacker.html', 'utf8');

  // Replace PRESETS array
  const presetsJson = JSON.stringify(data.deals, null, 2);
  const presetRegex = /const PRESETS = \[[\s\S]*?\];/;
  if (presetRegex.test(html)) {
    html = html.replace(presetRegex, 'const PRESETS = ' + presetsJson + ';');
    console.log('✓ Replaced PRESETS array');
  } else {
    console.log('⚠ PRESETS pattern not found — HTML structure may have changed');
  }

  // Replace any week label
  html = html.replace(/Week of [A-Za-z]+ \d{1,2},? \d{4}/g, 'Week of ' + data.weekOf);

  fs.writeFileSync('deal-stacker.html', html);
  console.log('✓ Wrote deal-stacker.html with', data.deals.length, 'deals for', data.weekOf);
  process.exit(0);
} catch(e) {
  console.error('Inject error:', e.message);
  // Don't fail the whole workflow — just log
  process.exit(0);
}
