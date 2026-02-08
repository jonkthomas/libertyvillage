#!/usr/bin/env node
/**
 * Captures fallback images for businesses whose websites failed.
 * Uses Google search pages as source.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "businesses.json");
const IMG_DIR = path.join(__dirname, "..", "public", "images", "businesses");

const fallbacks = [
  { slug: "hgr-graham-partners", search: "HGR Graham Partners Toronto law firm" },
  { slug: "certified-tire-auto", search: "Certified Tire Auto 1586 Queen Street West Toronto" },
  { slug: "king-west-village-cleaners", search: "King West Village Cleaners 1000 King St W Toronto" },
];

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });

  for (const fb of fallbacks) {
    const imgPath = path.join(IMG_DIR, `${fb.slug}.jpg`);
    console.log(`Capturing fallback for ${fb.slug}...`);
    try {
      const page = await context.newPage();
      // Try Yelp as a fallback source
      const yelpUrl = `https://www.yelp.ca/search?find_desc=${encodeURIComponent(fb.search)}&find_loc=Toronto%2C+ON`;
      await page.goto(yelpUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: imgPath, type: "jpeg", quality: 85, clip: { x: 0, y: 0, width: 1280, height: 720 } });
      await page.close();
      console.log(`  ✓ Saved ${fb.slug}.jpg (from Yelp search)`);
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message.substring(0, 80)}`);
      // Create a generic placeholder - use another business in same category as template
    }
  }

  await browser.close();

  // Update businesses.json
  const businesses = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  let updated = 0;
  for (const biz of businesses) {
    if (!biz.image) {
      const imgPath = path.join(IMG_DIR, `${biz.slug}.jpg`);
      if (fs.existsSync(imgPath)) {
        biz.image = `/images/businesses/${biz.slug}.jpg`;
        updated++;
      }
    }
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(businesses, null, 2));
  console.log(`\nUpdated ${updated} remaining business records`);
}

run().catch(console.error);
