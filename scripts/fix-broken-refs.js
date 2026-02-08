#!/usr/bin/env node
/**
 * Fixes all broken cross-references in data files.
 * Maps non-existent slugs to closest valid alternatives.
 */
const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const load = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
const save = (f, d) => fs.writeFileSync(path.join(dataDir, f), JSON.stringify(d, null, 2));

// Mapping: broken slug → correct slug (or null to remove)
const serviceMap = {
  "nightlife-guide": "bars",
  "family-activities": "daycares",
  "car-share": null, // no equivalent
  "moving-companies": "movers",
  "storage": null, // no equivalent
  "internet-providers": null, // not a service (it's a topic)
  "home-improvement": "house-cleaning",
  "property-management": "real-estate-agents",
  "legal-services": "lawyers",
  "electronics-repair": "it-support",
  "bike-rentals": "bike-shops",
  "cocktail-lounges": "wine-bars",
  "live-music-venues": "bars",
  "fitness-studios": "gyms",
  "daycare-centres": "daycares",
  "tutoring": "tutors",
  "sporting-goods": "bike-shops",
};

const topicMap = {
  "condo-buying": "moving-guide",
  "tfc-game-day": "happy-hour-guide",
  "renting-guide": "moving-guide",
  "daycare-guide": "family-activities",
  "dog-parks": "fitness-guide",
  "coffee-shops": "remote-work-spots", // topic context, not service
  "coyote-safety": "safety-guide",
  "grocery-shopping": "farmers-market",
};

function fixArray(arr, mapping) {
  if (!arr) return arr;
  let changed = false;
  const result = [];
  for (const item of arr) {
    if (mapping.hasOwnProperty(item)) {
      changed = true;
      const replacement = mapping[item];
      if (replacement && !result.includes(replacement)) {
        result.push(replacement);
        console.log(`    "${item}" → "${replacement}"`);
      } else if (!replacement) {
        console.log(`    "${item}" → REMOVED`);
      } else {
        console.log(`    "${item}" → "${replacement}" (deduplicated)`);
      }
    } else {
      result.push(item);
    }
  }
  return changed ? result : arr;
}

// Fix services.json
console.log("\n=== services.json ===");
const services = load("services.json");
let svcChanged = 0;
for (const svc of services) {
  const before = JSON.stringify(svc.relatedServices);
  console.log(`  ${svc.slug}:`);
  svc.relatedServices = fixArray(svc.relatedServices, serviceMap);
  if (JSON.stringify(svc.relatedServices) !== before) svcChanged++;
  else console.log("    (no changes)");
}
save("services.json", services);
console.log(`  Fixed: ${svcChanged} services\n`);

// Fix topics.json
console.log("=== topics.json ===");
const topics = load("topics.json");
let topicChanged = 0;
for (const topic of topics) {
  const before = JSON.stringify(topic);
  console.log(`  ${topic.slug}:`);
  topic.relatedServices = fixArray(topic.relatedServices, serviceMap);
  topic.relatedTopics = fixArray(topic.relatedTopics, topicMap);
  if (JSON.stringify(topic) !== before) topicChanged++;
  else console.log("    (no changes)");
}
save("topics.json", topics);
console.log(`  Fixed: ${topicChanged} topics\n`);

// Fix neighborhoods.json
console.log("=== neighborhoods.json ===");
const neighborhoods = load("neighborhoods.json");
let nbChanged = 0;
for (const nb of neighborhoods) {
  const before = JSON.stringify(nb.relatedServices);
  console.log(`  ${nb.slug}:`);
  nb.relatedServices = fixArray(nb.relatedServices, serviceMap);
  if (JSON.stringify(nb.relatedServices) !== before) nbChanged++;
  else console.log("    (no changes)");
}
save("neighborhoods.json", neighborhoods);
console.log(`  Fixed: ${nbChanged} neighborhoods\n`);

console.log(`Total: ${svcChanged + topicChanged + nbChanged} items fixed`);
