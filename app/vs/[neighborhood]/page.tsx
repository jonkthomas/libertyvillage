import { notFound } from "next/navigation";
import {
  getAllNeighborhoods,
  getNeighborhoodBySlug,
} from "@/lib/data";
import { generateComparisonPageMeta } from "@/lib/meta";
import { generateArticleSchema, generateSpeakableSchema } from "@/lib/schema";
import { getNearbyNeighborhoods, getBreadcrumbs } from "@/lib/links";
import { linkifyText, type LinkEntry } from "@/lib/linkify";
import { getAllServices, getAllBusinesses } from "@/lib/data";
import Breadcrumbs from "@/components/Breadcrumbs";
import HeroImage from "@/components/HeroImage";
import ComparisonTable from "@/components/ComparisonTable";
import FAQSection from "@/components/FAQSection";
import RelatedLinks from "@/components/RelatedLinks";
import AnswerBlock from "@/components/AnswerBlock";

interface Props {
  params: Promise<{ neighborhood: string }>;
}

// LV reference data
const LV = {
  avgRent1BR: 2600,
  avgRent2BR: 3400,
  transitScore: 78,
  walkScore: 85,
  bikeScore: 72,
  medianAge: 31,
  medianIncome: 99817,
};

export async function generateStaticParams() {
  const neighborhoods = getAllNeighborhoods();
  return neighborhoods.map((n) => ({ neighborhood: n.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { neighborhood: slug } = await params;
  const neighborhood = getNeighborhoodBySlug(slug);
  if (!neighborhood) return {};
  return generateComparisonPageMeta(neighborhood);
}

export default async function ComparisonPage({ params }: Props) {
  const { neighborhood: slug } = await params;
  const neighborhood = getNeighborhoodBySlug(slug);
  if (!neighborhood) notFound();

  const relatedNeighborhoods = getNearbyNeighborhoods(slug);
  const breadcrumbs = getBreadcrumbs("neighborhood", `vs ${neighborhood.name}`);

  // Build cross-linking lookups
  const services = getAllServices();
  const businesses = getAllBusinesses();
  const linkLookups: LinkEntry[] = [
    ...services.map((s) => ({ name: s.pluralName, href: `/best/${s.slug}` })),
    ...businesses.slice(0, 30).map((b) => ({ name: b.name, href: `/directory/${b.slug}` })),
  ];

  const articleSchema = generateArticleSchema(
    `Liberty Village vs ${neighborhood.name}`,
    neighborhood.verdict.summary,
    new Date().toISOString().split("T")[0]
  );
  const speakableSchema = neighborhood.answerBlock
    ? generateSpeakableSchema(`/vs/${neighborhood.slug}`)
    : null;

  const comparisonRows = [
    { label: "Avg 1BR Rent", lv: `$${LV.avgRent1BR.toLocaleString()}`, them: `$${neighborhood.avgRent1BR.toLocaleString()}` },
    { label: "Avg 2BR Rent", lv: `$${LV.avgRent2BR.toLocaleString()}`, them: `$${neighborhood.avgRent2BR.toLocaleString()}` },
    { label: "Transit Score", lv: `${LV.transitScore}/100`, them: `${neighborhood.transitScore}/100` },
    { label: "Walk Score", lv: `${LV.walkScore}/100`, them: `${neighborhood.walkScore}/100` },
    { label: "Bike Score", lv: `${LV.bikeScore}/100`, them: `${neighborhood.bikeScore}/100` },
    { label: "Median Age", lv: LV.medianAge, them: neighborhood.medianAge },
    { label: "Median Income", lv: `$${LV.medianIncome.toLocaleString()}`, them: `$${neighborhood.medianIncome.toLocaleString()}` },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      {neighborhood.image && (
        <HeroImage src={neighborhood.image} alt={`${neighborhood.name} neighborhood`} />
      )}

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Liberty Village vs {neighborhood.name}:{" "}
        <span className="text-warm-500">Where Should You Live?</span>
      </h1>

      {/* Quick Verdict */}
      {neighborhood.answerBlock ? (
        <AnswerBlock>{neighborhood.answerBlock}</AnswerBlock>
      ) : (
        <div className="mt-6 rounded-xl border-2 border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-800">Quick Verdict</h2>
          <p className="mt-2 text-warm-700 leading-relaxed">
            {neighborhood.verdict.summary}
          </p>
        </div>
      )}

      {/* Comparison Table */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold text-warm-900 mb-4">
          By the Numbers
        </h2>
        <ComparisonTable
          neighborhoodName={neighborhood.name}
          rows={comparisonRows}
        />
      </section>

      {/* Detailed Breakdown */}
      <section className="mt-12 space-y-8">
        <div>
          <h2 className="text-xl font-semibold text-warm-900">Cost of Living</h2>
          <p className="mt-2 text-warm-600 leading-relaxed">
            {neighborhood.detailedComparison.costOfLiving}
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-warm-900">Transit & Commute</h2>
          <p className="mt-2 text-warm-600 leading-relaxed">
            {neighborhood.detailedComparison.transitAndCommute}
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-warm-900">Food & Nightlife</h2>
          <p className="mt-2 text-warm-600 leading-relaxed">
            {linkifyText(neighborhood.detailedComparison.foodAndNightlife, linkLookups)}
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-warm-900">Safety & Community</h2>
          <p className="mt-2 text-warm-600 leading-relaxed">
            {linkifyText(neighborhood.detailedComparison.safetyAndCommunity, linkLookups)}
          </p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-warm-900">Best For</h2>
          <p className="mt-2 text-warm-600 leading-relaxed">
            {linkifyText(neighborhood.detailedComparison.bestFor, linkLookups)}
          </p>
        </div>
      </section>

      {/* Win Lists */}
      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl bg-amber-50 p-6">
          <h3 className="font-semibold text-amber-800">
            What Liberty Village Wins At
          </h3>
          <ul className="mt-3 space-y-2">
            {neighborhood.verdict.lvWinsAt.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-warm-700">
                <span className="text-amber-500 mt-0.5">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-warm-50 p-6">
          <h3 className="font-semibold text-warm-700">
            What {neighborhood.name} Wins At
          </h3>
          <ul className="mt-3 space-y-2">
            {neighborhood.verdict.theyWinAt.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-warm-700">
                <span className="text-warm-400 mt-0.5">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Bottom Line */}
      <section className="mt-12 rounded-xl border border-sage-400 bg-sage-50 p-6">
        <h2 className="text-lg font-semibold text-sage-600">The Bottom Line</h2>
        <p className="mt-2 text-warm-700 leading-relaxed">
          {neighborhood.keyDifference} Liberty Village is best for{" "}
          {neighborhood.verdict.lvWinsAt.slice(0, 2).join(" and ").toLowerCase()},
          while {neighborhood.name} shines with{" "}
          {neighborhood.verdict.theyWinAt.slice(0, 2).join(" and ").toLowerCase()}.
          Both are great Toronto neighborhoods — it comes down to your priorities.
        </p>
      </section>

      <FAQSection faqs={neighborhood.faqs} />

      <RelatedLinks
        heading="Compare Other Neighborhoods"
        links={relatedNeighborhoods}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      {speakableSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(speakableSchema) }}
        />
      )}
    </div>
  );
}
