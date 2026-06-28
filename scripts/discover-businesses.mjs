#!/usr/bin/env node
/**
 * Weekly Liberty Village business discovery.
 *
 * Queries Google Maps (via SerpApi) across the directory's service categories,
 * dedupes against the existing data/businesses.json, filters to the Liberty
 * Village geo-box + a quality bar, and appends up to MAX_NEW new basic
 * directory records. A GitHub Action runs this weekly and opens a PR with the
 * additions; records can then be enriched (descriptions are intentionally
 * templated here so the deterministic job never hallucinates facts).
 *
 * Env: SERPAPI_API_KEY (required), PEXELS_API_KEY (optional - adds a
 *      category-matched stock hero image per new business).
 * Usage: node scripts/discover-businesses.mjs [--max=15] [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.SERPAPI_API_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;
// Pexels' WAF 403s the default Node/urllib UA; a browser UA is required.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
if (!API_KEY) {
  console.error("ERROR: SERPAPI_API_KEY env var is required.");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const MAX_NEW = Number((args.find((a) => a.startsWith("--max=")) || "--max=15").split("=")[1]);

// Liberty Village geo-box (generous; tightened by the LV-core check below).
const BOX = { latMin: 43.63, latMax: 43.645, lngMin: -79.431, lngMax: -79.409 };
const CENTER = "@43.6378,-79.4200,15z";
const MIN_RATING = 4.0;
const MIN_REVIEWS = 50;

// Maps a search query to an existing directory category slug.
const CATEGORY_QUERIES = {
  restaurants: "restaurants",
  "coffee shops": "coffee-shops",
  bars: "bars",
  "wine bars": "wine-bars",
  breweries: "breweries",
  gyms: "gyms",
  "pilates studios": "pilates",
  "yoga studios": "yoga-studios",
  "hair salons": "hair-salons",
  barbers: "barbers",
  "nail salons": "nail-salons",
  spas: "spas",
  dentists: "dentists",
  physiotherapy: "physiotherapy",
  chiropractors: "chiropractors",
  "massage therapy": "massage-therapy",
  optometrists: "optometrists",
  bakeries: "bakeries",
  pizza: "pizza",
  sushi: "sushi",
  brunch: "brunch-spots",
  "pet stores": "pet-stores",
  "dog groomers": "dog-groomers",
  florists: "florists",
  "tattoo shops": "tattoo-parlors",
};

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data", "businesses.json");

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slugify = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const inLV = (lat, lng) =>
  lat != null && lng != null && lat >= BOX.latMin && lat <= BOX.latMax && lng >= BOX.lngMin && lng <= BOX.lngMax;
const lvCore = (b) => /M6K/.test(b.address || "") || /liberty/i.test((b.address || "") + (b.name || ""));
const priceRange = (p) => (typeof p === "string" && /\$/.test(p) ? p.match(/\$+/)[0] : "$$");

async function maps(query) {
  const url =
    `https://serpapi.com/search.json?engine=google_maps&type=search&ll=${encodeURIComponent(CENTER)}` +
    `&q=${encodeURIComponent(query + " Liberty Village Toronto")}&api_key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SerpApi ${res.status} for "${query}"`);
  const json = await res.json();
  return json.local_results || [];
}

// Category slug -> Pexels search query for a representative stock hero.
const PEXELS_QUERY = {
  restaurants: "restaurant interior dining", "italian-restaurants": "italian restaurant pasta",
  "thai-restaurants": "thai food restaurant", "indian-restaurants": "indian restaurant food",
  sushi: "sushi restaurant", pizza: "pizzeria pizza", "burger-joints": "burger restaurant",
  "brunch-spots": "brunch cafe", bars: "cocktail bar interior", "wine-bars": "wine bar",
  breweries: "brewery taproom", "coffee-shops": "coffee shop cafe interior", bakeries: "bakery pastries",
  gyms: "modern gym interior", pilates: "pilates studio", "yoga-studios": "yoga studio",
  "hair-salons": "hair salon interior", barbers: "barbershop", "nail-salons": "nail salon manicure",
  spas: "spa treatment room", dentists: "dental clinic", physiotherapy: "physiotherapy clinic",
  chiropractors: "chiropractic clinic", "massage-therapy": "massage therapy spa",
  optometrists: "eyewear store", "pet-stores": "pet store", "dog-groomers": "dog grooming",
  florists: "flower shop florist", "tattoo-parlors": "tattoo studio",
};

// Fetch a category-matched landscape image from Pexels, download to public/images/businesses/<slug>.jpg.
// Returns the public path, or "" on any failure (records stay blank-image, which renders fine).
async function fetchImage(slug, category) {
  if (!PEXELS_KEY) return "";
  const query = PEXELS_QUERY[category] || "toronto small business storefront";
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
      { headers: { Authorization: PEXELS_KEY, "User-Agent": UA } }
    );
    if (!res.ok) return "";
    const photos = (await res.json()).photos || [];
    if (!photos.length) return "";
    const src = photos[Math.floor(Math.random() * photos.length)].src.landscape.split("?")[0] +
      "?auto=compress&cs=tinysrgb&w=1280&h=720&fit=crop";
    const img = await fetch(src, { headers: { "User-Agent": UA } });
    if (!img.ok) return "";
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length < 5000) return "";
    const dir = path.join(ROOT, "public", "images", "businesses");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slug}.jpg`), buf);
    return `/images/businesses/${slug}.jpg`;
  } catch {
    return "";
  }
}

function toRecord(x, categorySlug) {
  const name = x.title;
  const rating = x.rating ?? 0;
  const reviewCount = x.reviews ?? 0;
  const hours = x.hours || x.open_state || "";
  return {
    slug: slugify(name),
    name,
    category: categorySlug,
    subcategory: x.type || "",
    address: x.address || "",
    description: `${name} is a ${(x.type || categorySlug.replace(/-/g, " "))} in Liberty Village${
      x.address ? `, located at ${x.address}` : ""
    }. It holds a ${rating}-star rating across ${reviewCount} Google reviews.`,
    rating,
    reviewCount,
    priceRange: priceRange(x.price),
    hours,
    phone: x.phone || "",
    website: x.website || "",
    tags: [categorySlug.replace(/-/g, " "), "liberty village", "toronto"],
    featured: false,
    proTip: "",
    image: "", // remote Maps thumbnails break next/image; enrich with local/Pexels images later
    answerBlock: `${name} is a ${rating}-star ${categorySlug.replace(/-/g, " ").replace(/s$/, "")} in Liberty Village${
      x.address ? ` at ${x.address}` : ""
    }, with ${reviewCount} Google reviews.`,
    bestFor: [],
    categories: [categorySlug],
    reviewExcerpt: `Reviewers rate ${name} ${rating}/5 across ${reviewCount} Google reviews.`,
    reviewFaqs: [
      {
        question: `What do reviews say about ${name}?`,
        answer: `${name} has a ${rating}-star average from ${reviewCount} Google reviews from Liberty Village locals and visitors.`,
      },
    ],
    _discoveredAt: new Date().toISOString().slice(0, 10),
    _needsEnrichment: true,
  };
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(DATA, "utf8"));
  const haveName = new Set(existing.map((b) => norm(b.name)));
  const haveAddr = new Set(existing.map((b) => norm(b.address).slice(0, 25)));
  const haveSlug = new Set(existing.map((b) => b.slug));

  const found = [];
  const seen = new Set();
  for (const [query, slug] of Object.entries(CATEGORY_QUERIES)) {
    let results = [];
    try {
      results = await maps(query);
    } catch (e) {
      console.warn("skip", query, String(e.message));
      continue;
    }
    for (const x of results) {
      const gc = x.gps_coordinates || {};
      const nn = norm(x.title);
      const ak = norm(x.address).slice(0, 25);
      if (!inLV(gc.latitude, gc.longitude)) continue;
      if (!lvCore({ name: x.title, address: x.address })) continue;
      if ((x.rating ?? 0) < MIN_RATING || (x.reviews ?? 0) < MIN_REVIEWS) continue;
      if (haveName.has(nn) || haveAddr.has(ak) || seen.has(nn)) continue;
      seen.add(nn);
      found.push(toRecord(x, slug));
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  found.sort((a, b) => b.reviewCount - a.reviewCount);
  const batch = [];
  for (const rec of found) {
    if (batch.length >= MAX_NEW) break;
    let s = rec.slug;
    let n = 2;
    while (haveSlug.has(s)) s = `${rec.slug}-${n++}`;
    rec.slug = s;
    haveSlug.add(s);
    batch.push(rec);
  }

  if (!DRY && PEXELS_KEY) {
    for (const rec of batch) {
      rec.image = await fetchImage(rec.slug, rec.category);
    }
    console.log(`Fetched ${batch.filter((b) => b.image).length}/${batch.length} Pexels images.`);
  }

  const date = new Date().toISOString().slice(0, 10);
  console.log(`Discovery ${date}: ${found.length} candidates, adding ${batch.length} (cap ${MAX_NEW}).`);
  batch.forEach((b) => console.log(`  + ${b.name} [${b.category}] ${b.rating}(${b.reviewCount})`));

  if (DRY) {
    console.log("--dry: no files written.");
    return;
  }
  if (!batch.length) {
    console.log("Nothing new to add.");
    return;
  }

  fs.writeFileSync(DATA, JSON.stringify([...existing, ...batch], null, 2) + "\n");
  fs.mkdirSync(path.join(ROOT, "tasks", "discovery-runs"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "tasks", "discovery-runs", `${date}.json`),
    JSON.stringify({ date, candidates: found.length, added: batch.map((b) => b.slug) }, null, 2) + "\n"
  );
  // Expose count for the GitHub Action step output.
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${batch.length}\n`);
  console.log(`Wrote ${batch.length} new businesses to data/businesses.json.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
