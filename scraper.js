// Weekly grocery deal scraper - direct fetch, no third-party API needed
// Targets publicly accessible ad data endpoints

const https = require('https');
const http = require('http');
const fs = require('fs');

const weekOf = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...options.headers
      },
      timeout: 15000
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Pull Publix BOGO deals from their JSON ad API
async function fetchPublixDeals() {
  const deals = [];
  try {
    console.log('Fetching Publix ad data...');
    const res = await fetch('https://www.publix.com/savings/weekly-ad/api/products?tag=bogo&storeZip=36578&limit=20');
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      const items = data.products || data.items || data.data || [];
      items.slice(0, 8).forEach(item => {
        const name = item.name || item.title || item.description || '';
        const price = parseFloat(item.price || item.regularPrice || item.salePrice || 0);
        if (name && price > 0) {
          deals.push({ name: name.trim(), store: 'Publix', regularPrice: price, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 });
        }
      });
    }
  } catch (e) {
    console.log('Publix JSON API unavailable:', e.message);
  }

  // Fallback: scrape Hip2Save which aggregates Publix BOGOs in plain HTML
  if (deals.length === 0) {
    try {
      console.log('Trying Hip2Save for Publix BOGOs...');
      const res = await fetch('https://hip2save.com/deals/publix-bogo/');
      if (res.status === 200) {
        const html = res.body;
        // Extract deal blocks: "Buy 2 [Item] $X.XX each"
        const buyPattern = /Buy\s+2?\s+\[?([^\]<\n]{3,60})\]?[^$]*\$(\d+\.\d{2})\s+each/gi;
        let match;
        while ((match = buyPattern.exec(html)) !== null && deals.length < 8) {
          const name = match[1].replace(/https?:\/\/[^\s]+/g, '').trim();
          const price = parseFloat(match[2]);
          if (name.length > 3 && price > 0 && !name.includes('http')) {
            deals.push({ name, store: 'Publix', regularPrice: price, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 });
          }
        }

        // Also look for coupon mentions near deals
        if (deals.length > 0) {
          const couponPattern = /\$(\d+(?:\.\d{2})?)\/?(\d+)?\s+(?:Publix digital coupon|digital coupon|printable coupon|mfr|manufacturer)/gi;
          let cMatch;
          let dealIdx = 0;
          while ((cMatch = couponPattern.exec(html)) !== null && dealIdx < deals.length) {
            const couponAmt = parseFloat(cMatch[1]);
            const isStore = /publix|store|digital/i.test(cMatch[0]);
            if (couponAmt > 0 && couponAmt < 10) {
              if (isStore) deals[dealIdx].storeCoupon = couponAmt;
              else deals[dealIdx].mfrCoupon = couponAmt;
              dealIdx++;
            }
          }
        }

        // Look for Ibotta mentions
        const ibottaPattern = /\$(\d+\.\d{2})\s+cash\s+back\s+via\s+Ibotta/gi;
        let iMatch;
        let iIdx = 0;
        while ((iMatch = ibottaPattern.exec(html)) !== null && iIdx < deals.length) {
          deals[iIdx].ibotta = parseFloat(iMatch[1]);
          iIdx++;
        }

        console.log(`Hip2Save: found ${deals.length} Publix BOGO deals`);
      }
    } catch (e) {
      console.log('Hip2Save unavailable:', e.message);
    }
  }

  return deals;
}

// Pull Winn-Dixie deals
async function fetchWinnDixieDeals() {
  const deals = [];
  try {
    console.log('Fetching Winn-Dixie deals...');
    const res = await fetch('https://www.winndixie.com/weeklyad');
    if (res.status === 200 && res.body.includes('bogo')) {
      const html = res.body;
      const bogoPattern = /([A-Z][^<\n]{5,50})<[^>]+>\s*BOGO|Buy\s+One.*?Get\s+One[^<]*<[^>]*>([^<]{5,50})/gi;
      let m;
      while ((m = bogoPattern.exec(html)) !== null && deals.length < 3) {
        const name = (m[1] || m[2] || '').trim();
        if (name.length > 4) {
          deals.push({ name, store: 'Winn-Dixie', regularPrice: 0, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 });
        }
      }
    }
  } catch (e) {
    console.log('Winn-Dixie unavailable:', e.message);
  }
  return deals;
}

// Hardcoded known-good fallback deals (updated manually by Claude each week if scrape fails)
function fallbackDeals() {
  console.log('Using fallback deals');
  return [
    { name: "Smithfield Bacon 12–16oz", store: "Publix", regularPrice: 9.99, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 },
    { name: "Cheez-It Crackers 6.5–12.4oz", store: "Publix", regularPrice: 5.08, bogo: true, mfrCoupon: 1.25, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 },
    { name: "Hellmann's Mayo 20oz", store: "Publix", regularPrice: 7.09, bogo: true, mfrCoupon: 0, storeCoupon: 2.00, ibotta: 0, checkout51: 0, qty: 2 },
    { name: "Summ! Spring Rolls", store: "Publix", regularPrice: 6.49, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 1.50, checkout51: 0, qty: 2 },
    { name: "Clairol Root Touch-Up", store: "Publix", regularPrice: 10.99, bogo: true, mfrCoupon: 0, storeCoupon: 6.00, ibotta: 0, checkout51: 0, qty: 2 },
  ];
}

async function run() {
  console.log(`\n=== Weekly scrape: ${weekOf} ===`);
  let deals = [];

  const [publix, winndixie] = await Promise.allSettled([
    fetchPublixDeals(),
    fetchWinnDixieDeals(),
  ]);

  if (publix.status === 'fulfilled') deals.push(...publix.value);
  if (winndixie.status === 'fulfilled') deals.push(...winndixie.value);

  // Fall back if nothing scraped
  if (deals.length === 0) deals = fallbackDeals();

  // Sort by savings % descending
  deals.sort((a, b) => {
    const savA = a.bogo ? a.regularPrice + a.mfrCoupon + a.storeCoupon + a.ibotta : a.mfrCoupon + a.storeCoupon + a.ibotta;
    const savB = b.bogo ? b.regularPrice + b.mfrCoupon + b.storeCoupon + b.ibotta : b.mfrCoupon + b.storeCoupon + b.ibotta;
    return savB - savA;
  });

  const output = {
    weekOf,
    updatedAt: new Date().toISOString(),
    source: deals === fallbackDeals() ? 'fallback' : 'scraped',
    deals
  };

  fs.writeFileSync('deals-data.json', JSON.stringify(output, null, 2));
  console.log(`\n✓ Wrote ${deals.length} deals to deals-data.json`);
  console.log('Top deal:', deals[0]?.name);
}

run().catch(e => {
  console.error('Fatal error:', e);
  // Write fallback so the site always has data
  const output = { weekOf, updatedAt: new Date().toISOString(), source: 'fallback', deals: fallbackDeals() };
  fs.writeFileSync('deals-data.json', JSON.stringify(output, null, 2));
});
