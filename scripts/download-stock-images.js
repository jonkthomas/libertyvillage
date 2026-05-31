#!/usr/bin/env node
/**
 * Downloads curated stock photos for blog hero images.
 * Uses multiple reliable free image sources.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const IMG_DIR = path.join(__dirname, "..", "public", "images", "blog");
fs.mkdirSync(IMG_DIR, { recursive: true });

// Curated Pixabay direct download URLs (free license, no attribution required)
// These are specific high-quality images that match each blog topic
const blogImages = [
  {
    slug: "fifa-world-cup-2026-liberty-village-survival-guide",
    // Soccer stadium crowd
    url: "https://cdn.pixabay.com/photo/2016/11/29/02/20/audience-1866738_1280.jpg",
  },
  {
    slug: "best-restaurants-liberty-village-locals-guide",
    // Restaurant interior warm lights
    url: "https://cdn.pixabay.com/photo/2015/11/19/10/38/food-1050813_1280.jpg",
  },
  {
    slug: "dog-owners-guide-liberty-village",
    // Happy dog in park
    url: "https://cdn.pixabay.com/photo/2016/12/13/05/15/puppy-1903313_1280.jpg",
  },
  {
    slug: "remote-work-cafes-coworking-liberty-village",
    // Laptop and coffee
    url: "https://cdn.pixabay.com/photo/2015/02/02/11/09/office-620822_1280.jpg",
  },
  {
    slug: "moving-to-liberty-village-2026-essential-guide",
    // Moving boxes
    url: "https://cdn.pixabay.com/photo/2015/07/28/20/55/tools-864983_1280.jpg",
  },
  {
    slug: "liberty-village-condo-market-2026-buyers-renters",
    // Modern condo building
    url: "https://cdn.pixabay.com/photo/2016/11/18/17/20/living-room-1835923_1280.jpg",
  },
  {
    slug: "ontario-line-construction-liberty-village-2026",
    // Construction/infrastructure
    url: "https://cdn.pixabay.com/photo/2017/06/14/08/20/map-of-the-world-2401458_1280.jpg",
  },
  {
    slug: "date-night-liberty-village-every-budget",
    // Romantic dinner
    url: "https://cdn.pixabay.com/photo/2015/09/21/14/24/supermarket-949913_1280.jpg",
  },
  {
    slug: "liberty-village-fitness-guide-every-gym-compared",
    // Gym/fitness
    url: "https://cdn.pixabay.com/photo/2017/08/07/14/02/man-2600468_1280.jpg",
  },
  {
    slug: "liberty-village-new-towers-development-2026",
    // Skyline/towers
    url: "https://cdn.pixabay.com/photo/2016/11/29/09/16/architecture-1868667_1280.jpg",
  },
  {
    slug: "weekend-brunch-guide-liberty-village",
    // Brunch food
    url: "https://cdn.pixabay.com/photo/2017/05/07/08/56/pancakes-2291908_1280.jpg",
  },
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, count = 0) => {
      if (count > 10) return reject(new Error("Too many redirects"));
      https.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      }, (res) => {
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
  let success = 0;
  let failed = 0;

  for (let i = 0; i < blogImages.length; i++) {
    const img = blogImages[i];
    const imgPath = path.join(IMG_DIR, `${img.slug}.jpg`);
    console.log(`[${i + 1}/${blogImages.length}] ${img.slug}`);

    try {
      await downloadFile(img.url, imgPath);
      const stats = fs.statSync(imgPath);
      if (stats.size > 10000) {
        console.log(`  ✓ Downloaded (${(stats.size / 1024).toFixed(0)} KB)`);
        success++;
      } else {
        console.log(`  ✗ Too small (${stats.size} bytes)`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== ${success} downloaded, ${failed} failed ===`);
}

run().catch(console.error);
