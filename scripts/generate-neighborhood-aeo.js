#!/usr/bin/env node

/**
 * generate-neighborhood-aeo.js
 *
 * Adds `answerBlock` to every neighborhood in neighborhoods.json.
 * Each answerBlock directly answers "Should I live in Liberty Village or [Neighborhood]?"
 * with a "Choose X if... Choose Y if..." structure, a specific number, and a clear tradeoff.
 */

const fs = require("fs");
const path = require("path");

const NEIGHBORHOODS_PATH = path.join(
  __dirname,
  "..",
  "data",
  "neighborhoods.json"
);

// Liberty Village reference data
const LV = {
  avgRent1BR: 2600,
  transitScore: 78,
  walkScore: 85,
  bikeScore: 72,
  medianAge: 31,
  medianIncome: 99817,
};

function generateAnswerBlock(n) {
  const rentDiff = Math.abs(n.avgRent1BR - LV.avgRent1BR);
  const lvCheaper = n.avgRent1BR > LV.avgRent1BR;
  const transitDiff = Math.abs(n.transitScore - LV.transitScore);
  const nTransitBetter = n.transitScore > LV.transitScore;

  // Build neighborhood-specific answer blocks using their actual data
  const blocks = {
    "king-west": `Choose Liberty Village if you want a genuine neighborhood community with lower rent. Choose King West if nightlife and walkability to Bay Street matter most. LV averages $2,600/month for a 1BR vs King West's $2,700 — a $100 difference. King West scores 90 for transit versus LV's 78, but that premium buys louder weekends and less green space.`,

    cityplace: `Choose Liberty Village if you want neighborhood character with local shops and community events. Choose CityPlace if budget is your top priority and you commute via Union Station. LV averages $2,600/month for a 1BR vs CityPlace's $2,500 — a $100 difference. CityPlace is cheaper but feels like a dormitory; LV offers an actual neighborhood identity worth the small premium.`,

    "queen-west": `Choose Liberty Village if you want a calmer residential feel at a lower price. Choose Queen West if walkability and Toronto's creative arts scene are non-negotiable. LV averages $2,600/month for a 1BR vs Queen West's $2,650 — a $50 difference. Queen West scores 92 for transit versus LV's 78, offering unmatched cultural vibrancy along its commercial strip.`,

    parkdale: `Choose Liberty Village if you want a polished, predictable condo neighborhood that feels safe. Choose Parkdale if you value authentic diversity and the lowest rent near downtown. LV averages $2,600/month for a 1BR vs Parkdale's $2,200 — a $400 savings in Parkdale. That gap is significant, but LV delivers a more cohesive community and modern housing stock.`,

    junction: `Choose Liberty Village if you want modern condos closer to downtown. Choose The Junction if you prefer heritage homes, a village atmosphere, and lower rent. LV averages $2,600/month for a 1BR vs The Junction's $2,300 — a $300 difference. The Junction's walk score trails LV, but its independent shops and residential charm appeal to a different lifestyle.`,

    leslieville: `Choose Liberty Village if you want a central west-end location with modern condos. Choose Leslieville if you want east-end beach access, more family-friendly streets, and character homes. LV averages $2,600/month for a 1BR vs Leslieville's $2,400 — a $200 difference. Leslieville mirrors LV's vibe on the opposite side of the city with more space for growing families.`,

    ossington: `Choose Liberty Village if you want a quieter residential neighborhood with community events and green space. Choose Ossington if Toronto's best cocktail bars and dining scene are your priority. LV averages $2,600/month for a 1BR vs Ossington's $2,550 — a $50 difference. Ossington scores 86 for transit versus LV's 78, but it is a nightlife corridor rather than a true residential neighborhood.`,

    "dundas-west": `Choose Liberty Village if you want cohesive modern housing and a tight-knit community. Choose Dundas West if you value subway access, cultural depth, and a walkable mix of old and new Toronto. LV averages $2,600/month for a 1BR vs Dundas West's $2,400 — a $200 difference. Dundas West offers Ossington station on Line 2, giving it a transit edge LV cannot match.`,

    corktown: `Choose Liberty Village if you want an established west-end community with slightly lower rent. Choose Corktown if you prefer heritage character and closer proximity to downtown's east side. LV averages $2,600/month for a 1BR vs Corktown's $2,650 — a $50 difference. Both are compact, revitalized neighborhoods for young professionals, but LV's community is more mature and settled.`,

    "distillery-district": `Choose Liberty Village if you want a lived-in neighborhood with everyday amenities and lower rent. Choose the Distillery District if you prioritize stunning architecture and a curated aesthetic. LV averages $2,600/month for a 1BR vs the Distillery's $2,750 — a $150 difference. The Distillery is beautiful but can feel like a tourist set; LV offers more practical day-to-day livability.`,

    "fort-york": `Choose Liberty Village if you want established local businesses and a strong community identity. Choose Fort York if newer condo towers and waterfront lake access are your priority. LV averages $2,600/month for a 1BR vs Fort York's $2,550 — a $50 difference. These adjacent neighborhoods share amenities, but LV has the community infrastructure Fort York is still building.`,

    niagara: `Choose Liberty Village if you want more local businesses, a larger community, and slightly cheaper rent. Choose Niagara if walkability to King West and downtown is your main concern. LV averages $2,600/month for a 1BR vs Niagara's $2,650 — a $50 difference. Niagara scores 87 for transit versus LV's 78, offering a quiet residential pocket steps from the core.`,

    "trinity-bellwoods": `Choose Liberty Village if you want a similar young-professional energy at a lower price with less pretension. Choose Trinity-Bellwoods if Toronto's iconic park and Instagram-worthy streetscape matter to you. LV averages $2,600/month for a 1BR vs Trinity-Bellwoods' $2,750 — a $150 monthly savings. Both attract the same demographic, but LV trades cachet for genuine community charm.`,

    roncesvalles: `Choose Liberty Village if you are a young professional who wants modern condos and a social scene. Choose Roncesvalles if you are starting a family and want heritage homes, top schools, and a village feel. LV averages $2,600/month for a 1BR vs Roncesvalles' $2,350 — a $250 difference favoring Roncy. These beloved west-end neighborhoods serve different life stages.`,

    "bloor-west-village": `Choose Liberty Village if you want urban energy, modern condos, and a young professional scene closer to downtown. Choose Bloor West Village if High Park access, excellent schools, and a settled family community are priorities. LV averages $2,600/month for a 1BR vs Bloor West Village's $2,150 — a $450 difference. BVW is the most affordable option but sits farther from the core.`,
  };

  return blocks[n.slug] || null;
}

function countWords(text) {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function validate(neighborhoods) {
  let allValid = true;
  const results = [];

  for (const n of neighborhoods) {
    const block = n.answerBlock;
    const errors = [];

    if (!block) {
      errors.push("MISSING answerBlock");
      results.push({ slug: n.slug, valid: false, errors });
      allValid = false;
      continue;
    }

    const wordCount = countWords(block);
    if (wordCount < 40 || wordCount > 65) {
      errors.push(`Word count ${wordCount} outside 40-65 range`);
    }

    if (!/\d/.test(block)) {
      errors.push("No number found in answerBlock");
    }

    if (!/Choose/i.test(block)) {
      errors.push('Missing "Choose" in answerBlock');
    }

    const valid = errors.length === 0;
    if (!valid) allValid = false;

    results.push({ slug: n.slug, valid, wordCount, errors });
  }

  return { allValid, results };
}

function main() {
  // Read neighborhoods.json
  const raw = fs.readFileSync(NEIGHBORHOODS_PATH, "utf-8");
  const neighborhoods = JSON.parse(raw);

  console.log(`Loaded ${neighborhoods.length} neighborhoods.\n`);

  // Add answerBlock to each
  let added = 0;
  for (const n of neighborhoods) {
    const block = generateAnswerBlock(n);
    if (block) {
      n.answerBlock = block;
      added++;
    } else {
      console.warn(`WARNING: No answerBlock generated for ${n.slug}`);
    }
  }

  console.log(`Added answerBlock to ${added} neighborhoods.\n`);

  // Validate
  const { allValid, results } = validate(neighborhoods);

  console.log("=== Validation Results ===\n");
  for (const r of results) {
    const status = r.valid ? "PASS" : "FAIL";
    const wordInfo = r.wordCount !== undefined ? ` (${r.wordCount} words)` : "";
    const errorInfo =
      r.errors.length > 0 ? ` — ${r.errors.join("; ")}` : "";
    console.log(`  [${status}] ${r.slug}${wordInfo}${errorInfo}`);
  }

  if (!allValid) {
    console.log("\nSome validations FAILED. Aborting write.");
    process.exit(1);
  }

  // Write back
  fs.writeFileSync(
    NEIGHBORHOODS_PATH,
    JSON.stringify(neighborhoods, null, 2) + "\n",
    "utf-8"
  );

  console.log(`\nWrote updated neighborhoods.json with ${added} answerBlocks.`);

  // Verify JSON is valid by re-reading
  try {
    const verify = JSON.parse(
      fs.readFileSync(NEIGHBORHOODS_PATH, "utf-8")
    );
    console.log(
      `Verified: JSON is valid. ${verify.length} neighborhoods loaded successfully.`
    );
  } catch (err) {
    console.error("ERROR: Written JSON is invalid!", err.message);
    process.exit(1);
  }
}

main();
