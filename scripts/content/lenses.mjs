// Review lenses for the content-store gate (§4.6 g3, §4.7).
//
// Automated kinds reuse review-agent's LENSES[kind] verbatim so a DB-mode gate
// scores exactly what the PR-mode gate scored. `manual` edits (operator CLI) get
// one lens set per site dataset: DATA (supportable facts), CONTENT (neutral, no
// unsupported claims), SHAPE (fields and links match the dataset).
import { LENSES } from '../automation/review-agent.mjs';

const lensSet = (label, facts, shape) => Object.freeze([
  `DATA lens: every ${label} fact (${facts}) must be supportable by the submitted record and consistent with the rest of the site; never invent local facts.`,
  `CONTENT lens: neutral, accurate, useful ${label} copy with no unsupported claims, superlatives, fabricated quotes, or implied firsthand endorsement.`,
  `SHAPE lens: ${shape}`,
]);

export const MANUAL_LENSES = Object.freeze({
  businesses: lensSet('business', 'name, address, hours, phone, website, rating, category',
    'the record keeps the businesses.json schema; slug, category and image stay consistent and every tag or link names something that exists.'),
  posts: lensSet('blog post', 'dates, places, businesses, numbers, links',
    'the record keeps the posts.json schema; related slugs, internal links and the image must refer to existing site content.'),
  buildings: lensSet('building', 'address, year built, units, rents, scores, amenities',
    'the record keeps the buildings.json schema; nearestBusinessSlugs and links must refer to existing site content.'),
  neighborhoods: lensSet('neighbourhood', 'rents, scores, population, distances, comparisons',
    'the record keeps the neighborhoods.json schema; the verdict and detailed comparison must stay consistent with its numeric stats.'),
  services: lensSet('service', 'definitions, comparison rows, local context',
    'the record keeps the services.json schema; relatedServices and links must refer to existing services and guides.'),
  topics: lensSet('guide topic', 'dates, places, tips, definitions, FAQs',
    'the record keeps the topics.json schema; relatedTopics, relatedServices and links must refer to existing site content.'),
  'guide-hub': lensSet('guide hub', 'population, rent, scores, boundaries, history, quick facts',
    'the singleton keeps the guide-hub.json schema; quick facts and the answer summary must agree with its numeric stats.'),
});

// kind==='manual' ? MANUAL_LENSES[dataset] : LENSES[kind]; fail closed on anything else.
export function lensesFor(kind, dataset) {
  const lenses = kind === 'manual' ? MANUAL_LENSES[dataset] : LENSES[kind];
  if (!Array.isArray(lenses) || lenses.length === 0) {
    throw new Error(`no review lenses for kind ${kind}${kind === 'manual' ? ` dataset ${dataset}` : ''}`);
  }
  return lenses;
}
