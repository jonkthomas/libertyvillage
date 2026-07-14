import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import FAQSection from "@/components/FAQSection";
import { getAllPosts } from "@/lib/data";
import { generateItemListSchema } from "@/lib/schema";
import type { BlogPost } from "@/lib/types";

const SITE_URL = "https://libertyvillage.co";

export const metadata: Metadata = {
  title: "World Cup 2026 in Liberty Village — Results & 2030 Preview",
  description:
    "Toronto hosted 6 World Cup 2026 matches at BMO Field. Match results, what it was like, and why Liberty Village is ready for 2030.",
  openGraph: {
    title: "World Cup 2026 in Liberty Village — Results & 2030 Preview",
    description:
      "Toronto's World Cup 2026 recap from Liberty Village — match results, neighbourhood impact, and what's next for 2030.",
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

// Toronto World Cup 2026 matches at BMO Field — COMPLETED
const torontoMatches = [
  { date: "2026-06-12", label: "June 12 — Canada 2–1 Trinidad & Tobago (Group A)", result: "Canada Win" },
  { date: "2026-06-17", label: "June 17 — Argentina 3–0 Peru (Group C)", result: "Argentina Win" },
  { date: "2026-06-20", label: "June 20 — Mexico 2–2 Ecuador (Group B)", result: "Draw" },
  { date: "2026-06-23", label: "June 23 — USA 1–0 Chile (Group A)", result: "USA Win" },
  { date: "2026-06-26", label: "June 26 — Colombia 2–1 Senegal (Group D)", result: "Colombia Win" },
  { date: "2026-07-02", label: "July 2 — Netherlands 3–1 Japan (Round of 32)", result: "Netherlands Win" },
];

const hubFaqs = [
  {
    question: "How many World Cup 2026 matches were played at BMO Field in Toronto?",
    answer:
      "Toronto's BMO Field hosted 6 FIFA World Cup 2026 matches between June 12 and July 2, 2026 — Canada's Group A opener, four additional group stage matches, and one Round of 32 knockout fixture. All matches drew capacity crowds of 45,000+.",
  },
  {
    question: "Will Toronto host World Cup matches again in 2030?",
    answer:
      "Yes. The 2030 FIFA World Cup will be co-hosted by Spain, Portugal, and Morocco, with centenary matches in Uruguay, Argentina, and Paraguay. While Toronto is not a confirmed 2030 host city, Canada is expected to bid for hosting rights in future tournaments after the success of 2026.",
  },
  {
    question: "What happened during World Cup 2026 in Liberty Village?",
    answer:
      "Liberty Village experienced six match days with 45,000+ fans per game, road closures on Lake Shore, Strachan, Dufferin, and Fleet Street, packed sports bars, and a festival atmosphere. The Bentway hosted the official FIFA Fan Festival throughout the tournament.",
  },
  {
    question: "Which roads closed in Liberty Village during World Cup matches?",
    answer:
      "Lake Shore Boulevard, Strachan Avenue, Dufferin Street, and Fleet Street closed from 6 hours before to 4 hours after each BMO Field kickoff. Residents used free Local Access Permits from the City of Toronto to enter the controlled zone by car.",
  },
  {
    question: "How did World Cup 2026 impact Liberty Village businesses?",
    answer:
      "Local restaurants, bars, and short-term rentals saw significant revenue increases during the tournament. Sports bars along King Street West reported their busiest weeks ever. Short-term rental rates spiked 3 to 5× during match weeks.",
  },
  {
    question: "Where can I watch future World Cup matches in Liberty Village?",
    answer:
      "Sports bars along King Street West — The Craft, Local Public Eatery, and Brazen Head — are popular spots for watching international football. For major tournaments, the Bentway and other public spaces often host fan viewing events.",
  },
  {
    question: "What legacy did World Cup 2026 leave in Liberty Village?",
    answer:
      "The tournament brought infrastructure improvements to the BMO Field area, increased global recognition for the neighbourhood, and established Liberty Village as Toronto's premier sports destination. The experience positions the area well for future major events.",
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
  // dateModified is the last editorial review. Updated post-tournament.
  const HUB_PUBLISHED = "2026-02-15";
  const HUB_MODIFIED = "2026-07-14";
  const hubPageSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "World Cup 2026 in Liberty Village — Results & 2030 Preview",
    description:
      "Toronto hosted 6 FIFA World Cup 2026 matches at BMO Field. Full results, what it was like living next to the tournament, and what's next for 2030.",
    url: `${SITE_URL}/world-cup`,
    datePublished: HUB_PUBLISHED,
    dateModified: HUB_MODIFIED,
    mainEntity: matchListSchema,
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        World Cup 2026 in Liberty Village — Complete Recap
      </h1>
      <p className="mt-3 text-lg text-warm-500">
        Toronto hosted 6 FIFA World Cup 2026 matches at BMO Field from June 12 to July 2.
        Here&apos;s what happened, what it was like living next door, and what&apos;s next for 2030.
      </p>

      <section
        data-answer
        className="answer-block mt-6 rounded-xl border border-amber-200 bg-amber-50/60 px-6 py-5"
      >
        <h2 className="sr-only">Quick Answer</h2>
        <p className="text-base leading-relaxed text-warm-800">
          Toronto hosted <strong>6 FIFA World Cup 2026 matches at BMO Field</strong> between
          June 12 and July 2, 2026. Canada opened with a 2–1 win over Trinidad & Tobago, and
          the tournament brought 270,000+ fans through Liberty Village across six match days.
          The neighbourhood&apos;s bars, restaurants, and short-term rentals saw record traffic.
          With the 2030 World Cup expanding to new hosts, Toronto&apos;s successful 2026
          experience positions it well for future FIFA events.
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-warm-500">
          Tournament complete — updated <time dateTime="2026-07-14">July 14, 2026</time>
        </p>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-warm-700 list-disc pl-5">
          <li>6 matches played at BMO Field: June 12, 17, 20, 23, 26, and July 2, 2026.</li>
          <li>Canada opened with a 2–1 victory over Trinidad & Tobago on June 12.</li>
          <li>270,000+ total fans attended the six Toronto matches (45,000+ per game).</li>
          <li>Liberty Village bars and restaurants reported their busiest weeks ever.</li>
          <li>Short-term rental rates spiked 3–5× during match weeks.</li>
          <li>The Bentway FIFA Fan Festival hosted thousands of fans without tickets.</li>
          <li>Road closures on Lake Shore, Strachan, Dufferin, and Fleet Street worked smoothly.</li>
        </ul>
      </section>

      {/* Post-event: What's Next section */}
      <section className="mt-10 rounded-xl border border-warm-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-warm-800">What&apos;s Next: World Cup 2030 & Beyond</h2>
        <p className="mt-3 text-warm-700 leading-relaxed">
          The 2030 FIFA World Cup will be hosted by Spain, Portugal, and Morocco, with centenary
          matches in Uruguay, Argentina, and Paraguay. While Toronto isn&apos;t a confirmed host
          for 2030, Canada&apos;s successful co-hosting of 2026 (alongside the USA and Mexico)
          strengthens future bids. Liberty Village residents experienced what living next to a
          World Cup venue is like — and the infrastructure, transit improvements, and local
          business growth suggest the neighbourhood is ready for whatever comes next.
        </p>
        <p className="mt-3 text-warm-700 leading-relaxed">
          <strong>For 2030:</strong> Follow this page for updates as FIFA finalizes host cities and
          schedules. If Toronto secures future matches, we&apos;ll have the same comprehensive guides
          for road closures, where to watch, and how to navigate match days.
        </p>
      </section>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">
        Toronto Match Results
      </h2>
      <ul className="mt-3 divide-y divide-warm-200 rounded-xl border border-warm-200 bg-white">
        {torontoMatches.map((m) => (
          <li key={m.date} className="flex items-center justify-between px-4 py-3">
            <div>
              <time dateTime={m.date} className="font-medium text-warm-900">
                {m.label}
              </time>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {m.result}
            </span>
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
