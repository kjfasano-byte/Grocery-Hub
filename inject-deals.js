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

  // Replace the freshness/status banner config so the site always tells the
  // truth about whether this week's deals are live or fallback data.
  const statusJson = JSON.stringify({
    source: data.source || 'fallback',
    weekOf: data.weekOf,
    fallbackAsOf: data.fallbackAsOf || data.weekOf,
  });
  const statusRegex = /const DATA_STATUS = \{[\s\S]*?\};/;
  if (statusRegex.test(html)) {
    html = html.replace(statusRegex, 'const DATA_STATUS = ' + statusJson + ';');
    console.log('✓ Replaced DATA_STATUS banner config (source: ' + data.source + ')');
  } else {
    console.log('⚠ DATA_STATUS pattern not found — HTML structure may have changed');
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
