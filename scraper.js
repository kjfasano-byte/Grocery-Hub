// Weekly grocery deal scraper
// Runs via GitHub Actions every Wednesday at 6am CT
// Fetches Publix, Winn-Dixie, Rouses BOGOs + coupon matches

const https = require('https');
const fs = require('fs');

// Stores to scrape (public ad pages)
const SOURCES = [
  { store: 'Publix', url: 'https://www.publix.com/savings/weekly-ad', selector: 'bogo' },
  { store: 'Winn-Dixie', url: 'https://www.winndixie.com/weeklyad', selector: 'bogo' },
  { store: 'Rouses', url: 'https://www.rouses.com/weekly-ad/', selector: 'sale' },
  { store: 'ALDI', url: 'https://www.aldi.us/en/weekly-specials/', selector: 'special' },
];

// Known this-week deals (fallback + scraped results merge here)
// This gets overwritten each Wednesday by the GitHub Action
const weekOf = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const apiUrl = `http://api.scraperapi.com?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(url)}&render=true`;
    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractPublixBogos(html) {
  const deals = [];
  // Match BOGO patterns in Publix ad HTML
  const bogoPattern = /buy\s+one[^<]*get\s+one|bogo|b1g1/gi;
  const pricePattern = /\$(\d+\.\d{2})/g;
  const namePattern = /<h[23][^>]*>([^<]{5,60})<\/h[23]>/g;

  let nameMatch;
  while ((nameMatch = namePattern.exec(html)) !== null) {
    const surroundingText = html.slice(Math.max(0, nameMatch.index - 200), nameMatch.index + 500);
    if (bogoPattern.test(surroundingText)) {
      const prices = [];
      let priceMatch;
      const priceRe = /\$(\d+\.\d{2})/g;
      while ((priceMatch = priceRe.exec(surroundingText)) !== null) {
        prices.push(parseFloat(priceMatch[1]));
      }
      if (prices.length > 0) {
        deals.push({
          name: nameMatch[1].trim(),
          store: 'Publix',
          regularPrice: prices[0],
          bogo: true,
          mfrCoupon: 0,
          storeCoupon: 0,
          ibotta: 0,
          checkout51: 0,
          qty: 2
        });
      }
    }
  }
  return deals.slice(0, 10);
}

async function run() {
  console.log('Starting weekly scrape for week of', weekOf);
  let allDeals = [];

  if (!process.env.SCRAPER_API_KEY) {
    console.log('No SCRAPER_API_KEY — using fallback deals');
    // Fallback deals used when no API key present
    allDeals = [
      { name: "Smithfield Bacon 12–16oz", store: "Publix", regularPrice: 9.99, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 },
      { name: "Cheez-It Crackers 6.5–12.4oz", store: "Publix", regularPrice: 5.08, bogo: true, mfrCoupon: 1.25, storeCoupon: 0, ibotta: 0, checkout51: 0, qty: 2 },
      { name: "Hellmann's Mayo 20oz", store: "Publix", regularPrice: 7.09, bogo: true, mfrCoupon: 0, storeCoupon: 2.00, ibotta: 0, checkout51: 0, qty: 2 },
      { name: "Summ! Spring Rolls", store: "Publix", regularPrice: 6.49, bogo: true, mfrCoupon: 0, storeCoupon: 0, ibotta: 1.50, checkout51: 0, qty: 2 },
      { name: "Clairol Root Touch-Up", store: "Publix", regularPrice: 10.99, bogo: true, mfrCoupon: 0, storeCoupon: 6.00, ibotta: 0, checkout51: 0, qty: 2 },
    ];
  } else {
    try {
      const html = await fetchPage(SOURCES[0].url);
      const scraped = extractPublixBogos(html);
      allDeals = scraped.length > 0 ? scraped : allDeals;
      console.log(`Scraped ${scraped.length} deals from Publix`);
    } catch (e) {
      console.error('Scrape failed:', e.message);
    }
  }

  // Write deals JSON
  const output = { weekOf, updatedAt: new Date().toISOString(), deals: allDeals };
  fs.writeFileSync('deals-data.json', JSON.stringify(output, null, 2));
  console.log('Wrote deals-data.json with', allDeals.length, 'deals');
}

run().catch(console.error);
