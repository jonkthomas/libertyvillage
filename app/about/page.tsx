import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import { generateBreadcrumbSchema, generateOrganizationSchema } from "@/lib/schema";

const SITE_URL = "https://libertyvillage.co";

export const metadata: Metadata = {
  title: "About LibertyVillage.co — Who We Are & How We Work",
  description:
    "LibertyVillage.co is an independent neighbourhood guide written by Liberty Village residents. Learn who we are, how we source our recommendations, and how to get in touch.",
  openGraph: {
    title: "About LibertyVillage.co — Who We Are & How We Work",
    description:
      "LibertyVillage.co is an independent neighbourhood guide written by Liberty Village residents.",
    type: "website",
    url: `${SITE_URL}/about`,
    siteName: "LibertyVillage.co",
    locale: "en_CA",
  },
  alternates: {
    canonical: `${SITE_URL}/about`,
    languages: { "en-CA": `${SITE_URL}/about` },
  },
};

const aboutPageSchema = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  url: `${SITE_URL}/about`,
  name: "About LibertyVillage.co",
  description:
    "LibertyVillage.co is an independent neighbourhood guide written by Liberty Village residents. This page covers who we are, how we source recommendations, and how to get in touch.",
  mainEntity: {
    "@type": "Organization",
    name: "LibertyVillage.co",
    url: SITE_URL,
    foundingDate: "2024",
    areaServed: {
      "@type": "Place",
      name: "Liberty Village, Toronto, Ontario, Canada",
    },
  },
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Breadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "About", href: "/about" },
      ]} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        About LibertyVillage.co
      </h1>
      <p className="mt-3 text-lg text-warm-500">
        An independent neighbourhood guide for the 9,000+ people who call
        Liberty Village, Toronto home.
      </p>

      <section
        data-answer
        className="answer-block mt-6 rounded-xl border border-amber-200 bg-amber-50/60 px-6 py-5"
      >
        <h2 className="sr-only">Quick Answer</h2>
        <p className="text-base leading-relaxed text-warm-800">
          LibertyVillage.co is an independent guide to Liberty Village, Toronto,
          started in 2024 by a small editorial team of neighbourhood residents.
          We review restaurants, services, and businesses that are actually
          inside or immediately serving the 0.45 km&sup2; neighbourhood, not
          businesses 10+ minutes away. All rankings are based on Google Reviews,
          firsthand visits, and input from other residents. We don&apos;t accept
          payment for placement, and sponsored content is labelled clearly.
        </p>
      </section>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">Who we are</h2>
      <p className="mt-3 text-warm-600 leading-relaxed">
        We&apos;re a team of Liberty Village residents — designers, writers,
        and long-time locals — who were tired of searching the same four
        outdated blog posts every time a friend moved to the neighbourhood.
        LibertyVillage.co is the guide we wished existed when we moved here.
      </p>
      <p className="mt-3 text-warm-600 leading-relaxed">
        We write under the collective byline <em>LibertyVillage.co Editorial</em>.
        Specific posts will credit individual contributors as the team grows.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">
        How we rank and recommend
      </h2>
      <ul className="mt-3 space-y-2 text-warm-600 leading-relaxed list-disc pl-5">
        <li>
          <strong>We visit in person.</strong> Every restaurant, gym, and coffee
          shop we recommend has been visited by at least one team member.
        </li>
        <li>
          <strong>We use Google Reviews as a floor, not a ceiling.</strong>{" "}
          Sustained 4.0+ ratings across 100+ reviews are a baseline. The final
          ranking reflects firsthand experience plus input from neighbours.
        </li>
        <li>
          <strong>We prioritize Liberty Village proper.</strong> Businesses
          further than a 10-minute walk from the centre of the neighbourhood
          are noted as &ldquo;nearby&rdquo; rather than included in the main
          rankings.
        </li>
        <li>
          <strong>We update yearly.</strong> Every service page and comparison
          is reviewed each January. Prices, hours, and new openings change fast
          in the neighbourhood.
        </li>
        <li>
          <strong>We don&apos;t accept payment for placement.</strong> If a post
          is sponsored, it&apos;s clearly labelled.
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">
        Where our data comes from
      </h2>
      <p className="mt-3 text-warm-600 leading-relaxed">
        Rent, demographic, and transit statistics reference the City of Toronto
        Open Data portal, Statistics Canada, the Toronto Regional Real Estate
        Board, and TTC service alerts. Business listings are sourced from
        Google Business Profile, verified in person, and confirmed with owners
        where possible. Event and road-closure information tracks City of
        Toronto announcements, TFC fixtures, and FIFA World Cup 2026 planning
        documents.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">
        Corrections &amp; contact
      </h2>
      <p className="mt-3 text-warm-600 leading-relaxed">
        Spot something out of date, a closed business, or a place we missed?
        Tell us — we update pages in 48 hours or less. Reach us through the
        newsletter form on any blog post, or via Google Business messaging
        for the neighbourhood directory.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">Quick facts</h2>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-warm-500">Founded</dt>
          <dd className="mt-1 text-base font-medium text-warm-900">2024</dd>
        </div>
        <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-warm-500">Coverage area</dt>
          <dd className="mt-1 text-base font-medium text-warm-900">Liberty Village, Toronto (0.45 km&sup2;)</dd>
        </div>
        <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-warm-500">Businesses tracked</dt>
          <dd className="mt-1 text-base font-medium text-warm-900">200+</dd>
        </div>
        <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-warm-500">Update frequency</dt>
          <dd className="mt-1 text-base font-medium text-warm-900">Weekly blog, annual service reviews</dd>
        </div>
      </dl>

      <div className="mt-12 flex flex-wrap gap-4">
        <Link
          href="/directory"
          className="inline-flex items-center rounded-xl bg-amber-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-600"
        >
          Browse the directory
        </Link>
        <Link
          href="/blog"
          className="inline-flex items-center rounded-xl border border-warm-300 bg-white px-6 py-3 text-sm font-semibold text-warm-700 transition-all hover:bg-warm-50"
        >
          Read the blog
        </Link>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutPageSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateBreadcrumbSchema([
            { label: "Home", href: "/" },
            { label: "About", href: "/about" },
          ])),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(generateOrganizationSchema()) }}
      />
    </div>
  );
}
