#!/usr/bin/env node
/**
 * Downloads hero images for blog posts from Unsplash source URLs.
 * Falls back to generating branded hero cards via HTML rendering.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const IMG_DIR = path.join(__dirname, "..", "public", "images", "blog");
const POSTS_FILE = path.join(__dirname, "..", "data", "posts.json");

fs.mkdirSync(IMG_DIR, { recursive: true });

// Blog posts with search queries for stock photos
const blogImages = [
  { slug: "fifa-world-cup-2026-liberty-village-survival-guide", query: "soccer stadium fans celebration", color: "#1e3a5f", icon: "⚽" },
  { slug: "best-restaurants-liberty-village-locals-guide", query: "restaurant interior warm lighting toronto", color: "#92400e", icon: "🍽️" },
  { slug: "dog-owners-guide-liberty-village", query: "happy dog park city urban", color: "#166534", icon: "🐕" },
  { slug: "remote-work-cafes-coworking-liberty-village", query: "laptop coffee shop coworking", color: "#1e40af", icon: "💻" },
  { slug: "moving-to-liberty-village-2026-essential-guide", query: "moving boxes new apartment city", color: "#7c2d12", icon: "📦" },
  { slug: "liberty-village-condo-market-2026-buyers-renters", query: "modern condo building city skyline", color: "#4338ca", icon: "🏙️" },
  { slug: "ontario-line-construction-liberty-village-2026", query: "subway tunnel construction infrastructure", color: "#374151", icon: "🚇" },
  { slug: "date-night-liberty-village-every-budget", query: "couple dinner restaurant candle romantic", color: "#9f1239", icon: "🌙" },
  { slug: "liberty-village-fitness-guide-every-gym-compared", query: "gym fitness weights workout modern", color: "#0f766e", icon: "💪" },
  { slug: "liberty-village-new-towers-development-2026", query: "construction crane skyscraper city development", color: "#525252", icon: "🏗️" },
  { slug: "weekend-brunch-guide-liberty-village", query: "brunch pancakes eggs coffee morning", color: "#b45309", icon: "🥞" },
  { slug: "best-bars-restaurants-near-bmo-field-world-cup-2026", query: "sports bar crowd beer world cup", color: "#b91c1c", icon: "🍺" },
  { slug: "walking-liberty-village-to-bmo-field-game-day-route", query: "people walking urban path stadium", color: "#0369a1", icon: "🚶" },
  { slug: "liberty-village-world-cup-road-closures-resident-access", query: "city road closure barricade traffic", color: "#dc2626", icon: "🚧" },
  { slug: "watch-world-cup-liberty-village-without-tickets", query: "outdoor fan zone big screen soccer", color: "#7c3aed", icon: "📺" },
  { slug: "rent-liberty-village-condo-world-cup-airbnb-guide", query: "modern condo interior airbnb toronto", color: "#059669", icon: "🏠" },
  { slug: "best-patios-liberty-village-2026-guide", query: "restaurant patio outdoor dining summer", color: "#d97706", icon: "☀️" },
  { slug: "coworking-spaces-liberty-village-compared-2026", query: "modern coworking office space desks", color: "#2563eb", icon: "🖥️" },
  { slug: "grocery-stores-liberty-village-complete-guide", query: "grocery store fresh produce aisle", color: "#16a34a", icon: "🛒" },
];

function generateHeroHTML(post, title) {
  return `<!DOCTYPE html>
<html><head><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  width: 1280px; height: 720px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, ${post.color} 0%, ${adjustColor(post.color, 30)} 50%, ${adjustColor(post.color, 60)} 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow: hidden; position: relative;
}
.bg-pattern {
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 15% 25%, rgba(255,255,255,0.08) 0%, transparent 50%),
    radial-gradient(circle at 85% 75%, rgba(255,255,255,0.06) 0%, transparent 50%),
    radial-gradient(circle at 50% 10%, rgba(255,255,255,0.04) 0%, transparent 40%);
}
.dots {
  position: absolute; inset: 0;
  background-image: radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px);
  background-size: 24px 24px;
}
.card { text-align: center; color: white; padding: 60px 80px; position: relative; z-index: 1; max-width: 1000px; }
.icon { font-size: 80px; margin-bottom: 24px; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.3)); }
.title {
  font-size: 42px; font-weight: 800; letter-spacing: -1px; line-height: 1.2;
  margin-bottom: 20px; text-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.divider { width: 100px; height: 4px; background: rgba(255,255,255,0.4); margin: 0 auto 20px; border-radius: 2px; }
.badge {
  display: inline-block; padding: 6px 18px; border-radius: 20px;
  background: rgba(255,255,255,0.15); backdrop-filter: blur(4px);
  font-size: 14px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase;
}
.brand {
  position: absolute; bottom: 24px; right: 32px;
  font-size: 14px; opacity: 0.35; letter-spacing: 1px; color: white;
}
</style></head>
<body>
  <div class="bg-pattern"></div>
  <div class="dots"></div>
  <div class="card">
    <div class="icon">${post.icon}</div>
    <div class="title">${escapeHTML(title)}</div>
    <div class="divider"></div>
    <div class="badge">libertyvillage.co</div>
  </div>
  <div class="brand">LibertyVillage.co</div>
</body></html>`;
}

function adjustColor(hex, amount) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, ((num >> 16) & 0xFF) + amount);
  const g = Math.min(255, ((num >> 8) & 0xFF) + amount);
  const b = Math.min(255, (num & 0xFF) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function escapeHTML(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const request = (url, redirectCount = 0) => {
      if (redirectCount > 5) return reject(new Error("Too many redirects"));
      protocol.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const fileStream = fs.createWriteStream(dest);
        res.pipe(fileStream);
        fileStream.on("finish", () => { fileStream.close(); resolve(true); });
        fileStream.on("error", reject);
      }).on("error", reject);
    };
    request(url);
  });
}

async function run() {
  const posts = JSON.parse(fs.readFileSync(POSTS_FILE, "utf8"));
  const postMap = {};
  posts.forEach(p => { postMap[p.slug] = p; });

  // First try downloading from Unsplash source
  console.log("Attempting Unsplash downloads...\n");
  const needsFallback = [];

  for (const img of blogImages) {
    const imgPath = path.join(IMG_DIR, `${img.slug}.jpg`);
    const unsplashUrl = `https://source.unsplash.com/1280x720/?${encodeURIComponent(img.query)}`;
    console.log(`[${img.slug}] Trying Unsplash...`);
    try {
      await downloadImage(unsplashUrl, imgPath);
      const stats = fs.statSync(imgPath);
      if (stats.size > 10000) {
        console.log(`  ✓ Downloaded (${(stats.size / 1024).toFixed(0)} KB)`);
      } else {
        console.log(`  ✗ File too small (${stats.size} bytes), needs fallback`);
        needsFallback.push(img);
      }
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      needsFallback.push(img);
    }
  }

  // Generate branded hero cards for any that failed
  if (needsFallback.length > 0) {
    console.log(`\nGenerating ${needsFallback.length} branded hero images...\n`);
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

    for (const img of needsFallback) {
      const imgPath = path.join(IMG_DIR, `${img.slug}.jpg`);
      const post = postMap[img.slug];
      const title = post ? post.title : img.slug.replace(/-/g, " ");
      console.log(`  Generating ${img.slug}...`);
      const page = await context.newPage();
      await page.setContent(generateHeroHTML(img, title), { waitUntil: "load" });
      await page.waitForTimeout(300);
      await page.screenshot({ path: imgPath, type: "jpeg", quality: 90, clip: { x: 0, y: 0, width: 1280, height: 720 } });
      await page.close();
      console.log(`  ✓ Generated ${img.slug}.jpg`);
    }
    await browser.close();
  }

  // Update posts.json with image paths
  console.log("\nUpdating posts.json...");
  let updated = 0;
  for (const post of posts) {
    const imgPath = path.join(IMG_DIR, `${post.slug}.jpg`);
    if (fs.existsSync(imgPath) && !post.image) {
      post.image = `/images/blog/${post.slug}.jpg`;
      updated++;
    }
  }
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
  console.log(`Updated ${updated} post records with image paths`);
  console.log("\n=== DONE ===");
}

run().catch(console.error);
