import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import FAQSection from "@/components/FAQSection";
import { getAllPosts } from "@/lib/data";
import { generateItemListSchema } from "@/lib/schema";
import type { BlogPost } from "@/lib/types";

const SITE_URL = "https://libertyvillage.co";

export const metadata: Metadata = {
  title: "Liberty Village FIFA World Cup 2026 Guide — Every Match & Closure",
  description:
    "Toronto's complete FIFA World Cup 2026 guide from Liberty Village. Match schedule, BMO Field tickets, road closures, sports bars, volunteering, and where to watch every game.",
  openGraph: {
    title: "Liberty Village FIFA World Cup 2026 Guide",
    description:
      "Toronto's complete FIFA World Cup 2026 guide from Liberty Village — match schedule, tickets, closures, bars, jobs, and more.",
    type: "website",
    url: `${SITE_URL}/world-cup`,
    siteName: "LibertyVillage.co",
    locale: "en_CA",
    images: [{ url: `${SITE_URL}/images/og/og-home.jpg`, width: 1200, height: 630 }],
  },
  alternates: {
    canonical: `${SITE_URL}/world-cup`,
    languages: { "en-CA": `${SITE_URL}/world-cup` },
  },
};

// Toronto World Cup 2026 matches at BMO Field (confirmed by FIFA)
const torontoMatches = [
  { date: "2026-06-12", label: "June 12 — Canada vs Opponent (Group A opener)" },
  { date: "2026-06-17", label: "June 17 — Group stage match" },
  { date: "2026-06-20", label: "June 20 — Group stage match" },
  { date: "2026-06-23", label: "June 23 — Group stage match" },
  { date: "2026-06-26", label: "June 26 — Group stage match" },
  { date: "2026-07-02", label: "July 2 — Round of 32" },
];

const hubFaqs = [
  {
    question: "How many World Cup 2026 matches are at BMO Field in Toronto?",
    answer:
      "Toronto's BMO Field hosts 6 FIFA World Cup 2026 matches in June and early July, including Canada's Group A opener on June 12, four additional group stage matches, and one Round of 32 knockout fixture on July 2.",
  },
  {
    question: "How do I volunteer for FIFA World Cup 2026 in Toronto?",
    answer:
      "Applications open through FIFA's official volunteer portal. Toronto-specific roles include fan engagement, transportation, media operations, and venue support at BMO Field. See our full volunteer guide linked below for step-by-step application instructions.",
  },
  {
    question: "Where can I watch World Cup matches in Liberty Village without tickets?",
    answer:
      "The Bentway FIFA Fan Festival is the free official viewing site for Toronto, under the Gardiner near Liberty Village. Sports bars along King Street West — The Craft, Local Public Eatery, Brazen Head — broadcast every match. See our watch-without-tickets guide for a full list.",
  },
  {
    question: "Which roads close in Liberty Village during World Cup matches?",
    answer:
      "Lake Shore Boulevard, Strachan Avenue, Dufferin Street, and Fleet Street close from 6 hours before to 4 hours after each BMO Field kickoff. Residents need a free Local Access Permit from the City of Toronto to enter the controlled zone by car.",
  },
  {
    question: "Are there paid jobs at BMO Field during World Cup 2026?",
    answer:
      "Yes. Paid roles include hospitality, security, event operations, ticketing, merchandising, and language support. Most jobs are contracted through FIFA's official staffing partners and pay competitive hourly rates. See our full jobs guide for current listings.",
  },
  {
    question: "Can I rent out my Liberty Village condo during the World Cup?",
    answer:
      "Yes — short-term rental rates in Liberty Village spike 3 to 5× during World Cup dates. Check Airbnb, Vrbo, and Sonder. Toronto's short-term rental bylaw requires registration for any rental under 28 days. Our rental guide covers registration and pricing tips.",
  },
  {
    question: "Will Liberty Village be crowded during World Cup 2026?",
    answer:
      "Yes, especially on match days. Expect 45,000+ fans at BMO Field per match, plus fan walkways through Liberty Village on the way to and from the stadium. Streets are liveliest 3 hours before kickoff and 2 hours after the final whistle.",
  },
];

function postCard(post: BlogPost) {
  return (
    <Link
      key={post.slug}
      href={`/blog/${post.slug}`}
      className="group block rounded-xl border border-warm-200 bg-white p-5 shadow-sm transition-all hover:border-amber-300 hover:shadow-md"
    >
      <h3 className="font-semibold text-warm-900 group-hover:text-amber-700 transition-colors">
        {post.title}
      </h3>
      <p className="mt-1 text-sm text-warm-600 line-clamp-3">{post.description}</p>
      <span className="mt-3 inline-flex items-center text-xs font-semibold text-amber-700">
        Read guide →
      </span>
    </Link>
  );
}

export default function WorldCupHubPage() {
  const allPosts = getAllPosts();
  const worldCupPosts = allPosts.filter(
    (p) =>
      /world-cup|fifa|bmo-field/i.test(p.slug) ||
      (p.tags || []).some((t) => /world.?cup|fifa|bmo/i.test(t))
  );

  // Group by intent
  const scheduleAndTickets = worldCupPosts.filter((p) =>
    /schedule|tickets/i.test(p.slug)
  );
  const accessAndLogistics = worldCupPosts.filter((p) =>
    /road-closures|walking|events-near/i.test(p.slug)
  );
  const whereToWatch = worldCupPosts.filter((p) =>
    /watch|fan-zone|bentway|survival-guide/i.test(p.slug)
  );
  const diningAndBars = worldCupPosts.filter((p) =>
    /bars-restaurants|game-day-dining/i.test(p.slug)
  );
  const fansGuides = worldCupPosts.filter((p) => /fans-guide/i.test(p.slug));
  const jobsAndVolunteer = worldCupPosts.filter((p) =>
    /jobs|volunteer/i.test(p.slug)
  );
  const accommodation = worldCupPosts.filter((p) =>
    /rent|airbnb/i.test(p.slug)
  );

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "FIFA World Cup 2026", href: "/world-cup" },
  ];

  const matchListSchema = generateItemListSchema(
    torontoMatches.map((m) => ({ name: m.label })),
    "Toronto FIFA World Cup 2026 Matches at BMO Field"
  );

  // Time-sensitive dated hub. datePublished is when this hub first went live;
  // dateModified is the last editorial review (kept in sync with the answer
  // block's "As of" date below). Bump dateModified whenever facts here change.
  const HUB_PUBLISHED = "2026-02-15";
  const HUB_MODIFIED = "2026-06-28";
  const hubPageSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Liberty Village FIFA World Cup 2026 Guide",
    description:
      "Toronto's complete FIFA World Cup 2026 guide from Liberty Village: the six BMO Field matches, road closures, where to watch, and game-day logistics.",
    url: `${SITE_URL}/world-cup`,
    datePublished: HUB_PUBLISHED,
    dateModified: HUB_MODIFIED,
    mainEntity: matchListSchema,
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        FIFA World Cup 2026 in Liberty Village
      </h1>
      <p className="mt-3 text-lg text-warm-500">
        Everything you need for the 6 Toronto matches at BMO Field — from schedule
        and tickets to road closures, where to watch, and what it&apos;s like living
        next door.
      </p>

      <section
        data-answer
        className="answer-block mt-6 rounded-xl border border-amber-200 bg-amber-50/60 px-6 py-5"
      >
        <h2 className="sr-only">Quick Answer</h2>
        <p className="text-base leading-relaxed text-warm-800">
          Toronto hosts <strong>6 FIFA World Cup 2026 matches at BMO Field</strong>:
          Canada&apos;s Group A opener on <strong>June 12</strong>, four additional group
          stage matches on <strong>June 17, 20, 23, and 26</strong>, and a{" "}
          <strong>Round of 32 knockout on July 2</strong>. BMO Field is a 15-minute walk
          from the centre of Liberty Village. Lake Shore, Strachan, Dufferin, and Fleet
          Street close around every match; residents get free Local Access Permits.
          The Bentway FIFA Fan Festival is the free official viewing site under the
          Gardiner for fans without tickets.
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-warm-500">
          Key facts — as of <time dateTime="2026-06-28">June 28, 2026</time>
        </p>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-warm-700 list-disc pl-5">
          <li>6 Toronto matches at BMO Field: June 12, 17, 20, 23, 26, and July 2, 2026.</li>
          <li>June 12 is Canada&apos;s Group A opener; July 2 is a Round of 32 knockout fixture.</li>
          <li>BMO Field is a 15-minute walk from the centre of Liberty Village.</li>
          <li>Expect 45,000+ fans per match; streets are busiest 3 hours before kickoff and 2 hours after.</li>
          <li>Lake Shore Boulevard, Strachan Avenue, Dufferin Street, and Fleet Street close around each kickoff.</li>
          <li>Residents need a free City of Toronto Local Access Permit to drive into the controlled zone.</li>
          <li>The Bentway FIFA Fan Festival is the free official viewing site for fans without tickets.</li>
        </ul>
      </section>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">
        Toronto Match Schedule
      </h2>
      <ul className="mt-3 divide-y divide-warm-200 rounded-xl border border-warm-200 bg-white">
        {torontoMatches.map((m) => (
          <li key={m.date} className="px-4 py-3 text-warm-700">
            <time dateTime={m.date} className="font-medium text-warm-900">
              {m.label}
            </time>
          </li>
        ))}
      </ul>

      {scheduleAndTickets.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold text-warm-800">
            Schedule &amp; Tickets
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {scheduleAndTickets.map(postCard)}
          </div>
        </>
      )}

      {accessAndLogistics.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold text-warm-800">
            Road Closures &amp; Getting Around
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {accessAndLogistics.map(postCard)}
          </div>
        </>
      )}

      {whereToWatch.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold text-warm-800">
            Where to Watch
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {whereToWatch.map(postCard)}
          </div>
        </>
      )}

      {diningAndBars.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold text-warm-800">
            Game-Day Dining &amp; Bars
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {diningAndBars.map(postCard)}
          </div>
        </>
      )}

      {fansGuides.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold text-warm-800">
            Fan Guides by Country
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {fansGuides.map(postCard)}
          </div>
        </>
      )}

      {jobsAndVolunteer.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold text-warm-800">
            Jobs &amp; Volunteering
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {jobsAndVolunteer.map(postCard)}
          </div>
        </>
      )}

      {accommodation.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold text-warm-800">
            Accommodation &amp; Condo Rentals
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {accommodation.map(postCard)}
          </div>
        </>
      )}

      <FAQSection faqs={hubFaqs} />

      {/* Breadcrumb + FAQ JSON-LD are emitted by the Breadcrumbs and FAQSection components. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(hubPageSchema) }}
      />
    </div>
  );
}
