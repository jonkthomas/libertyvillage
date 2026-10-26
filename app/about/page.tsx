import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import { generateOrganizationSchema } from "@/lib/schema";

const SITE_URL = "https://libertyvillage.co";

export const metadata: Metadata = {
  title: "About LibertyVillage.co — Who We Are & How We Work",
  description:
    "LibertyVillage.co is an independent neighbourhood guide to Liberty Village, Toronto. Learn how we choose and rank businesses, where our data comes from, and how to get in touch.",
  openGraph: {
    title: "About LibertyVillage.co — Who We Are & How We Work",
    description:
      "LibertyVillage.co is an independent neighbourhood guide to Liberty Village, Toronto.",
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
    "LibertyVillage.co is an independent neighbourhood guide to Liberty Village, Toronto. This page covers how we choose and rank businesses, where our data comes from, and how to get in touch.",
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
      {/* TODO verify against City of Toronto Open Data: canonical facts — population
          "about 9,000" and area "28 hectares (0.28 km²)" — must stay identical to the
          homepage answer block/FAQ schema and public/llms.txt. */}
      <p className="mt-3 text-lg text-warm-500">
        An independent neighbourhood guide for the roughly 9,000 people who call
        Liberty Village, Toronto home.
      </p>

      <section
        data-answer
        className="answer-block mt-6 rounded-xl border border-amber-200 bg-amber-50/60 px-6 py-5"
      >
        <h2 className="sr-only">Quick Answer</h2>
        <p className="text-base leading-relaxed text-warm-800">
          LibertyVillage.co is an independent guide to Liberty Village, Toronto,
          started in 2024 and published under one collective byline. We cover
          restaurants, services, and businesses that are inside or immediately
          serving the 28-hectare (0.28 km&sup2;) neighbourhood. Rankings are
          based mainly on Google Reviews ratings and review volume. We
          don&apos;t accept payment for placement, and sponsored content is
          labelled clearly.
        </p>
      </section>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">Who we are</h2>
      <p className="mt-3 text-warm-600 leading-relaxed">
        LibertyVillage.co is an independent project that puts what you need to
        know about Liberty Village in one place: local businesses, condo
        buildings, parking, transit, and things to do. The guides that existed
        before it were scattered and often out of date.
      </p>
      <p className="mt-3 text-warm-600 leading-relaxed">
        Everything is published under the collective byline{" "}
        <em>LibertyVillage.co Editorial</em> rather than individual names.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">
        How we rank and recommend
      </h2>
      <ul className="mt-3 space-y-2 text-warm-600 leading-relaxed list-disc pl-5">
        <li>
          <strong>We start from public reviews.</strong> Google Reviews ratings
          and review volume are the main ranking signal, so a long record of
          good reviews counts for more than a handful of five-star ones.
        </li>
        <li>
          <strong>We focus on Liberty Village proper.</strong> Listings are
          businesses inside the neighbourhood or immediately serving it.
        </li>
        <li>
          <strong>We keep pages current.</strong> New posts go out every week,
          and pages are corrected when we find or are told about outdated
          prices, hours, or openings.
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
        Board, and TTC service alerts. Business listings are compiled from
        public sources, including Google listings and business websites. Event
        and road-closure information tracks City of
        Toronto announcements, TFC fixtures, and FIFA World Cup 2026 planning
        documents.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">
        Corrections &amp; contact
      </h2>
      <p className="mt-3 text-warm-600 leading-relaxed">
        Spot something out of date, a closed business, or a place we missed?
        Email{" "}
        <a
          href="mailto:hello@libertyvillage.co"
          className="font-medium text-amber-700 underline hover:text-amber-900"
        >
          hello@libertyvillage.co
        </a>{" "}
        and we&apos;ll correct it.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-warm-800">Quick facts</h2>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-warm-500">Founded</dt>
          <dd className="mt-1 text-base font-medium text-warm-900">2024</dd>
        </div>
        <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-warm-500">Coverage area</dt>
          <dd className="mt-1 text-base font-medium text-warm-900">Liberty Village, Toronto (28 ha / 0.28 km&sup2;)</dd>
        </div>
        <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-warm-500">Businesses tracked</dt>
          <dd className="mt-1 text-base font-medium text-warm-900">200+</dd>
        </div>
        <div className="rounded-lg border border-warm-200 bg-warm-50 px-4 py-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-warm-500">Update frequency</dt>
          <dd className="mt-1 text-base font-medium text-warm-900">New blog posts weekly</dd>
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

      {/* Breadcrumb JSON-LD is emitted by the Breadcrumbs component. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutPageSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(generateOrganizationSchema()) }}
      />
    </div>
  );
}
