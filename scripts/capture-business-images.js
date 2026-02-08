#!/usr/bin/env node
/**
 * Captures hero screenshots from business websites for use as directory images.
 * Uses Playwright with headless Chromium. Tracks progress in a JSON file.
 *
 * Usage: node scripts/capture-business-images.js
 * Resume: node scripts/capture-business-images.js --resume
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "businesses.json");
const IMG_DIR = path.join(__dirname, "..", "public", "images", "businesses");
const TRACKER_FILE = path.join(__dirname, "..", "tasks", "image-capture-progress.json");

async function run() {
  const resume = process.argv.includes("--resume");

  // Load businesses missing images
  const businesses = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const missing = businesses.filter(b => !b.image && b.website);

  // Load or initialize tracker
  let tracker = {};
  if (resume && fs.existsSync(TRACKER_FILE)) {
    tracker = JSON.parse(fs.readFileSync(TRACKER_FILE, "utf8"));
    console.log(`Resuming from previous run (${Object.keys(tracker).length} already processed)`);
  }

  console.log(`\nBusinesses needing images: ${missing.length}`);
  console.log(`Output directory: ${IMG_DIR}\n`);

  // Ensure output dirs exist
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(TRACKER_FILE), { recursive: true });

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < missing.length; i++) {
    const biz = missing[i];
    const imgFile = `${biz.slug}.jpg`;
    const imgPath = path.join(IMG_DIR, imgFile);

    // Skip if already captured
    if (tracker[biz.slug] === "done" || fs.existsSync(imgPath)) {
      skipped++;
      console.log(`[${i+1}/${missing.length}] SKIP ${biz.slug} (already captured)`);
      continue;
    }

    console.log(`[${i+1}/${missing.length}] Capturing ${biz.slug} from ${biz.website}...`);

    try {
      const page = await context.newPage();

      // Navigate with timeout
      await page.goto(biz.website, {
        waitUntil: "domcontentloaded",
        timeout: 15000
      });

      // Wait a bit for images to load
      await page.waitForTimeout(2000);

      // Try to dismiss cookie banners / popups
      try {
        const dismissSelectors = [
          'button:has-text("Accept")',
          'button:has-text("Close")',
          'button:has-text("Got it")',
          'button:has-text("OK")',
          '[class*="cookie"] button',
          '[class*="popup"] button[class*="close"]',
        ];
        for (const sel of dismissSelectors) {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            await btn.click().catch(() => {});
            await page.waitForTimeout(500);
            break;
          }
        }
      } catch { /* ignore popup dismissal errors */ }

      // Take screenshot
      await page.screenshot({
        path: imgPath,
        type: "jpeg",
        quality: 85,
        clip: { x: 0, y: 0, width: 1280, height: 720 }
      });

      await page.close();

      tracker[biz.slug] = "done";
      success++;
      console.log(`  ✓ Saved ${imgFile}`);

    } catch (err) {
      tracker[biz.slug] = `error: ${err.message.substring(0, 100)}`;
      failed++;
      console.log(`  ✗ Failed: ${err.message.substring(0, 80)}`);
    }

    // Save progress after each capture
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(tracker, null, 2));
  }

  await browser.close();

  // Update businesses.json with image paths for successful captures
  console.log("\nUpdating businesses.json with image paths...");
  let updated = 0;
  for (const biz of businesses) {
    if (!biz.image) {
      const imgFile = `${biz.slug}.jpg`;
      const imgPath = path.join(IMG_DIR, imgFile);
      if (fs.existsSync(imgPath)) {
        biz.image = `/images/businesses/${imgFile}`;
        updated++;
      }
    }
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(businesses, null, 2));

  console.log(`\n=== CAPTURE COMPLETE ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Updated: ${updated} business records`);

  // List failures for manual follow-up
  const failures = Object.entries(tracker).filter(([,v]) => v.startsWith("error"));
  if (failures.length > 0) {
    console.log(`\nFailed captures (need manual attention):`);
    failures.forEach(([slug, err]) => console.log(`  ${slug}: ${err}`));
  }
}

run().catch(console.error);
