// Weekly grocery deal scraper - direct fetch, no third-party API needed
// Targets publicly accessible ad data endpoints

const https = require('https');
const http = require('http');
const fs = require('fs');

const weekOf = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// Hand-verified fallback data — last manually confirmed by Claude against real
// app screenshots / flyer pages. Update FALLBACK_AS_OF whenever this list is refreshed.
const FALLBACK_AS_OF = "June 20, 2026";

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

// Pull Dollar General deals. DG's own digital coupons live behind a logged-in
// app session and can't be scraped directly, so this targets public deal blogs
// that publish DG ad + coupon matchups each week (item-level "DG Digital" coupons,
// not the in-app-only "spend $X" storewide offers — those still require checking
// the app since they're account-specific).
async function fetchDollarGeneralDeals() {
  const deals = [];
  const sources = [
    'https://hip2save.com/deals/dollar-general-deals/',
    'https://thekrazycouponlady.com/tips/store/dollar-general',
  ];

  for (const url of sources) {
    if (deals.length >= 8) break;
    try {
      console.log(`Trying ${url} for Dollar General deals...`);
      const res = await fetch(url);
      if (res.status !== 200) continue;
      const html = res.body;

      // Pattern A: "ItemName $X.XX, Use $Y DG Digital Coupon, Final Price $Z.ZZ"
      const stackPattern = /([A-Z][A-Za-z0-9®'’.\- ]{4,55})[^$]{0,40}\$(\d+\.\d{2})[^$]{0,60}(?:DG\s*Digital|Dollar General\s*Digital)\s*Coupon[^$]{0,30}\$(\d+(?:\.\d{2})?)[^$]{0,60}Final\s*Price[^$]{0,10}\$(\d+\.\d{2})/gi;
      let m;
      while ((m = stackPattern.exec(html)) !== null && deals.length < 8) {
        const name = m[1].replace(/https?:\/\/[^\s]+/g, '').trim();
        const regularPrice = parseFloat(m[2]);
        const storeCoupon = parseFloat(m[3]);
        if (name.length > 3 && regularPrice > 0) {
          deals.push({ name, store: 'Dollar General', regularPrice, bogo: false, mfrCoupon: 0, storeCoupon, ibotta: 0, checkout51: 0, qty: 1 });
        }
      }

      // Pattern B (looser): "$X off ONE [Item]" digital coupon callouts without a paired price
      if (deals.length === 0) {
        const couponOnlyPattern = /\$(\d+(?:\.\d{2})?)\s*off\s*ONE\s+([A-Z][A-Za-z0-9®'’.\- ]{4,55})/gi;
        while ((m = couponOnlyPattern.exec(html)) !== null && deals.length < 8) {
          const storeCoupon = parseFloat(m[1]);
          const name = m[2].trim();
          if (name.length > 3 && storeCoupon > 0) {
            // No shelf price available from this pattern — leave regularPrice at 0
            // so it's obviously incomplete rather than silently wrong.
            deals.push({ name, store: 'Dollar General', regularPrice: 0, bogo: false, mfrCoupon: 0, storeCoupon, ibotta: 0, checkout51: 0, qty: 1 });
          }
        }
      }

      console.log(`${url}: found ${deals.length} Dollar General deals so far`);
    } catch (e) {
      console.log(`${url} unavailable:`, e.message);
    }
  }

  // Drop any deal scraped with no usable price — better to show fewer real
  // deals than ones missing the number that actually matters.
  return deals.filter(d => d.regularPrice > 0 || d.storeCoupon > 0);
}

// Hand-verified fallback deals — used only when every live scrape comes back
// empty. Kept honest in the UI via FALLBACK_AS_OF + the source flag below,
// so stale data is always labeled as stale instead of pretending to be fresh.
function fallbackDeals() {
  console.log('Using fallback deals (last verified ' + FALLBACK_AS_OF + ')');
  return [
    { name: "Smithfield Bacon 12–16oz", store: "Publix", regularPrice: 9.99, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 },
    { name: "Cheez-It Crackers 6.5–12.4oz", store: "Publix", regularPrice: 5.08, bogo: true, mfrCoupon: 1.25, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 },
    { name: "Hellmann's Mayo 20oz", store: "Publix", regularPrice: 7.09, bogo: true, mfrCoupon: 0, storeCoupon: 2.00, ibotta: 0, checkout51: 0, qty: 2 },
    { name: "Summ! Spring Rolls", store: "Publix", regularPrice: 6.49, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 1.50, checkout51: 0, qty: 2 },
    { name: "Clairol Root Touch-Up", store: "Publix", regularPrice: 10.99, bogo: true, mfrCoupon: 0, storeCoupon: 6.00, ibotta: 0, checkout51: 0, qty: 2 },
    { name: "Gain Plus Liquid Detergent 75ld/99oz", store: "Dollar General", regularPrice: 13.45, bogo: false, mfrCoupon: 0, storeCoupon: 3.00, ibotta: 0, checkout51: 0, qty: 1 },
    { name: "Gain Flings 24ct / Softener 98ld / Sheets / Powder", store: "Dollar General", regularPrice: 7.50, bogo: false, mfrCoupon: 0, storeCoupon: 2.00, ibotta: 0, checkout51: 0, qty: 1 },
    { name: "Gain Flings 60ct / Original 100ld / Fireworks", store: "Dollar General", regularPrice: 15.95, bogo: false, mfrCoupon: 0, storeCoupon: 3.00, ibotta: 0, checkout51: 0, qty: 1 },
  ];
}

async function run() {
  console.log(`\n=== Weekly scrape: ${weekOf} ===`);
  let deals = [];

  const [publix, winndixie, dollargeneral] = await Promise.allSettled([
    fetchPublixDeals(),
    fetchWinnDixieDeals(),
    fetchDollarGeneralDeals(),
  ]);

  if (publix.status === 'fulfilled') deals.push(...publix.value);
  if (winndixie.status === 'fulfilled') deals.push(...winndixie.value);
  if (dollargeneral.status === 'fulfilled') deals.push(...dollargeneral.value);

  // Fall back if nothing scraped from any store — track this explicitly
  // instead of comparing array references (that comparison was always false,
  // which silently mislabeled stale fallback data as freshly "scraped").
  let usedFallback = false;
  if (deals.length === 0) {
    deals = fallbackDeals();
    usedFallback = true;
  }

  // Sort by savings % descending
  deals.sort((a, b) => {
    const savA = a.bogo ? a.regularPrice + a.mfrCoupon + a.storeCoupon + a.ibotta : a.mfrCoupon + a.storeCoupon + a.ibotta;
    const savB = b.bogo ? b.regularPrice + b.mfrCoupon + b.storeCoupon + b.ibotta : b.mfrCoupon + b.storeCoupon + b.ibotta;
    return savB - savA;
  });

  const output = {
    weekOf,
    updatedAt: new Date().toISOString(),
    source: usedFallback ? 'fallback' : 'scraped',
    fallbackAsOf: FALLBACK_AS_OF,
    deals
  };

  fs.writeFileSync('deals-data.json', JSON.stringify(output, null, 2));
  console.log(`\n✓ Wrote ${deals.length} deals to deals-data.json (source: ${output.source})`);
  console.log('Top deal:', deals[0]?.name);
}

run().catch(e => {
  console.error('Fatal error:', e);
  // Write fallback so the site always has data, clearly labeled as such
  const output = { weekOf, updatedAt: new Date().toISOString(), source: 'fallback', fallbackAsOf: FALLBACK_AS_OF, deals: fallbackDeals() };
  fs.writeFileSync('deals-data.json', JSON.stringify(output, null, 2));
});
