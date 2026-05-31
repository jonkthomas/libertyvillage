#!/usr/bin/env node
/**
 * Downloads free stock photos from Pexels for blog hero images.
 * Uses Playwright to navigate, find image URLs, then downloads them.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const https = require("https");

const IMG_DIR = path.join(__dirname, "..", "public", "images", "blog");

const blogImages = [
  { slug: "fifa-world-cup-2026-liberty-village-survival-guide", query: "soccer stadium crowd" },
  { slug: "best-restaurants-liberty-village-locals-guide", query: "restaurant table food warm" },
  { slug: "dog-owners-guide-liberty-village", query: "dog park city" },
  { slug: "remote-work-cafes-coworking-liberty-village", query: "laptop coffee shop" },
  { slug: "moving-to-liberty-village-2026-essential-guide", query: "moving boxes apartment" },
  { slug: "liberty-village-condo-market-2026-buyers-renters", query: "modern condo building" },
  { slug: "ontario-line-construction-liberty-village-2026", query: "subway tunnel construction" },
  { slug: "date-night-liberty-village-every-budget", query: "couple dinner romantic restaurant" },
  { slug: "liberty-village-fitness-guide-every-gym-compared", query: "modern gym weights" },
  { slug: "liberty-village-new-towers-development-2026", query: "skyscraper construction crane" },
  { slug: "weekend-brunch-guide-liberty-village", query: "brunch food pancakes" },
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, count = 0) => {
      if (count > 10) return reject(new Error("Too many redirects"));
      const mod = url.startsWith("https") ? https : require("http");
      mod.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, count + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const ws = fs.createWriteStream(dest);
        res.pipe(ws);
        ws.on("finish", () => { ws.close(); resolve(); });
        ws.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  let success = 0;

  for (let i = 0; i < blogImages.length; i++) {
    const img = blogImages[i];
    const imgPath = path.join(IMG_DIR, `${img.slug}.jpg`);
    console.log(`\n[${i + 1}/${blogImages.length}] ${img.slug}`);
    console.log(`  Search: "${img.query}"`);

    try {
      const page = await context.newPage();

      // Navigate to Pexels search
      const url = `https://www.pexels.com/search/${encodeURIComponent(img.query)}/`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);

      // Find the first landscape-oriented image (wider than tall)
      // Pexels uses img tags with srcset or data-src attributes
      const imageUrl = await page.evaluate(() => {
        // Look for gallery images
        const imgs = document.querySelectorAll('img[srcset], img[data-src], article img');
        for (const img of imgs) {
          const src = img.srcset || img.getAttribute("data-src") || img.src;
          if (src && src.includes("pexels") && !src.includes("avatar") && !src.includes("logo")) {
            // Extract the highest quality URL from srcset
            if (img.srcset) {
              const parts = img.srcset.split(",").map(s => s.trim());
              const last = parts[parts.length - 1].split(" ")[0];
              if (last && last.startsWith("http")) return last;
            }
            if (img.src && img.src.startsWith("http")) return img.src;
          }
        }
        // Fallback: any large image on the page
        const allImgs = document.querySelectorAll("img");
        for (const img of allImgs) {
          if (img.naturalWidth > 400 && img.src.includes("images.pexels.com")) {
            return img.src;
          }
        }
        return null;
      });

      await page.close();

      if (imageUrl) {
        // Modify URL to get specific size: ?auto=compress&cs=tinysrgb&w=1280&h=720&dpr=1
        let downloadUrl = imageUrl.split("?")[0];
        downloadUrl += "?auto=compress&cs=tinysrgb&w=1280&h=720&fit=crop";
        console.log(`  Downloading from Pexels...`);
        await downloadFile(downloadUrl, imgPath);
        const stats = fs.statSync(imgPath);
        if (stats.size > 5000) {
          console.log(`  ✓ Downloaded (${(stats.size / 1024).toFixed(0)} KB)`);
          success++;
        } else {
          console.log(`  ✗ File too small, keeping existing`);
        }
      } else {
        console.log(`  ✗ Could not find image URL on page`);
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message.substring(0, 80)}`);
    }
  }

  await browser.close();
  console.log(`\n=== COMPLETE: ${success}/${blogImages.length} downloaded from Pexels ===`);
}

run().catch(console.error);
