import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getAllBusinesses,
  getBusinessBySlug,
  getServiceBySlug,
} from "@/lib/data";
import { generateBusinessPageMeta } from "@/lib/meta";
import { generateLocalBusinessSchema } from "@/lib/schema";
import {
  getRelatedBusinesses,
  getBreadcrumbs,
} from "@/lib/links";
import Breadcrumbs from "@/components/Breadcrumbs";
import HeroImage from "@/components/HeroImage";
import FAQSection from "@/components/FAQSection";
import RelatedLinks from "@/components/RelatedLinks";
import AnswerBlock from "@/components/AnswerBlock";
import { linkifyText, type LinkEntry } from "@/lib/linkify";
import { getAllServices } from "@/lib/data";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const businesses = getAllBusinesses();
  return businesses.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const business = getBusinessBySlug(slug);
  if (!business) return {};
  return generateBusinessPageMeta(business);
}

type FaqEntry = { question: string; answer: string };

type BusinessCategoryType =
  | "food-drink"
  | "events"
  | "fitness"
  | "medical"
  | "beauty"
  | "pets"
  | "professional"
  | "workspace"
  | "rentals"
  | "home-services";

// Map a business category slug to a broad type so FAQs stay relevant — e.g. the
// "good for groups?" question only appears for food/drink and event categories,
// never for dentists, lawyers, locksmiths, and similar.
function getBusinessCategoryType(slug: string): BusinessCategoryType {
  const groups: Record<BusinessCategoryType, string[]> = {
    "food-drink": [
      "restaurants", "coffee-shops", "brunch-spots", "bars", "patios",
      "breweries", "wine-bars", "pizza", "sushi", "thai-restaurants",
      "italian-restaurants", "indian-restaurants", "burger-joints", "bakeries",
    ],
    events: ["caterers", "event-spaces"],
    fitness: ["gyms", "yoga-studios", "pilates", "personal-trainers"],
    medical: [
      "dentists", "doctors", "veterinarians", "optometrists", "physiotherapy",
      "chiropractors", "massage-therapy", "pharmacies",
    ],
    beauty: ["hair-salons", "barbers", "nail-salons", "spas", "tattoo-parlors"],
    pets: ["dog-walkers", "dog-groomers", "pet-stores"],
    professional: [
      "lawyers", "accountants", "real-estate-agents", "insurance-agents",
      "banks", "it-support", "interior-designers", "tutors", "music-lessons",
    ],
    workspace: ["coworking-spaces"],
    rentals: ["short-term-rentals"],
    "home-services": [
      "house-cleaning", "movers", "dry-cleaners", "tailors", "laundromats",
      "auto-repair", "bike-shops", "locksmith", "printing-services", "florists",
      "grocery-stores", "photographers", "daycares",
    ],
  };
  for (const [type, slugs] of Object.entries(groups)) {
    if (slugs.includes(slug)) return type as BusinessCategoryType;
  }
  return "home-services";
}

function getBusinessFAQs(business: { name: string; category: string; hours: string; priceRange?: string }): FaqEntry[] {
  const { name, hours, priceRange } = business;
  const type = getBusinessCategoryType(business.category);

  const hoursQ: FaqEntry = {
    question: `What are the hours for ${name}?`,
    answer: `${name} is open ${hours}. Hours can change on holidays and seasonally, so it's best to call ahead or check the website to confirm before visiting.`,
  };
  const priceQ: FaqEntry = {
    question: `How much does ${name} cost?`,
    answer: priceRange
      ? `${name} is rated ${priceRange} for pricing, in line with comparable options in the Liberty Village and Toronto west-end area. Ask for current prices, as rates can vary.`
      : `A verified price range is not listed for ${name}. Check the website or contact the business for current prices.`,
  };

  const sets: Record<BusinessCategoryType, FaqEntry[]> = {
    "food-drink": [
      hoursQ,
      {
        question: `Does ${name} take reservations or walk-ins?`,
        answer: `${name} welcomes Liberty Village locals and visitors alike. Walk-ins are usually fine at quieter times, but for busy evenings and weekends it's worth booking ahead or calling to check the current wait.`,
      },
      {
        question: `Is ${name} good for groups?`,
        answer: `${name} can be a good option for groups, though Liberty Village rooms are often compact. For parties of six or more, call ahead to confirm seating and ask about any group menu or minimum.`,
      },
      priceQ,
    ],
    events: [
      hoursQ,
      {
        question: `How far in advance should you book ${name}?`,
        answer: `For weekend and peak-season dates, reserve ${name} several weeks ahead; popular slots go early. Smaller weekday bookings need less lead time. Confirm deposit and cancellation terms when you enquire.`,
      },
      {
        question: `What size events can ${name} accommodate?`,
        answer: `${name} can host a range of group sizes — discuss your headcount, layout, and any catering or A/V needs directly so they can confirm capacity and pricing for your Liberty Village event.`,
      },
      priceQ,
    ],
    fitness: [
      hoursQ,
      {
        question: `Does ${name} offer a free trial or drop-in pass?`,
        answer: `Many Liberty Village fitness spots offer an intro trial or single drop-in. Contact ${name} to ask about trial classes, day passes, and whether a tour is available before you commit to a membership.`,
      },
      {
        question: `How much does membership at ${name} cost?`,
        answer: priceRange
          ? `${name} is rated ${priceRange} for pricing. Ask about current membership fees, joining fees, and contract length when you sign up.`
          : `A verified membership price range is not listed for ${name}. Contact the business for current fees, joining fees, and contract terms.`,
      },
    ],
    medical: [
      hoursQ,
      {
        question: `Is ${name} accepting new patients?`,
        answer: `Availability changes regularly, so call ${name} or check their website before visiting. Ask about wait times and what to bring for a first appointment to avoid a wasted trip.`,
      },
      {
        question: `Does ${name} direct-bill insurance?`,
        answer: `Many Liberty Village clinics direct-bill major insurers, but practices differ. Confirm with ${name} and have your policy details ready, since OHIP-covered and extended-health services are handled differently.`,
      },
    ],
    beauty: [
      hoursQ,
      {
        question: `Does ${name} take walk-ins or require an appointment?`,
        answer: `${name} mostly works by appointment, especially for longer services, with limited walk-in availability at quieter times. Weekend and after-work slots book up fastest, so reserve ahead.`,
      },
      priceQ,
    ],
    pets: [
      hoursQ,
      {
        question: `What services does ${name} offer?`,
        answer: `${name} serves Liberty Village pet owners — contact them for the full list of services, availability, and whether they offer neighbourhood pickup, drop-in visits, or appointment-based care.`,
      },
      priceQ,
    ],
    professional: [
      hoursQ,
      {
        question: `Does ${name} offer a free initial consultation?`,
        answer: `Many Liberty Village professionals offer a brief no-cost consultation to scope your needs before quoting. Contact ${name} to confirm whether an initial consultation is free and how long it runs.`,
      },
      {
        question: `How much does ${name} charge?`,
        answer: priceRange
          ? `${name} is rated ${priceRange} for pricing. Request a written estimate before engaging.`
          : `A verified fee range is not listed for ${name}. Request a written estimate before engaging.`,
      },
    ],
    workspace: [
      hoursQ,
      {
        question: `Does ${name} offer day passes or monthly memberships?`,
        answer: `${name} typically offers flexible options — from day passes to dedicated desks and private offices. Contact them to confirm current plans, pricing tiers, and whether a tour or trial day is available.`,
      },
      {
        question: `What amenities does ${name} offer?`,
        answer: `Expect essentials like Wi-Fi, meeting rooms, printing, and coffee, with some spaces adding phone booths or events. ${name} sits within Liberty Village's TTC- and GO-connected core, making it an easy commute. Confirm specific amenities directly.`,
      },
    ],
    rentals: [
      hoursQ,
      {
        question: `What is the minimum stay at ${name}?`,
        answer: `Minimum stays vary by host and season — some require a few nights while others suit longer corporate or relocation stays. Confirm directly with ${name}, as Toronto's short-term-rental rules can affect availability.`,
      },
      {
        question: `What amenities does ${name} include?`,
        answer: `${name} offers Liberty Village's walkable access to King West dining and TTC/GO transit. Confirm in-suite laundry, Wi-Fi, building gym, parking, and pet policies directly, along with check-in details.`,
      },
    ],
    "home-services": [
      hoursQ,
      {
        question: `Does ${name} require an appointment or offer same-day service?`,
        answer: `${name} generally works by appointment, though same-day or urgent requests may be possible for an added fee. Booking ahead secures a preferred time — contact them to confirm availability and any service-call charge.`,
      },
      priceQ,
    ],
  };

  return sets[type];
}

export default async function BusinessDetailPage({ params }: Props) {
  const { slug } = await params;
  const business = getBusinessBySlug(slug);
  if (!business) notFound();

  const service = getServiceBySlug(business.category);
  const allServices = getAllServices();
  const relatedBusinesses = getRelatedBusinesses(slug, business.category);
  const breadcrumbs = getBreadcrumbs("business", business.name);
  const faqs = getBusinessFAQs(business);

  // Build lookup map for cross-linking
  const linkLookups: LinkEntry[] = allServices.map((s) => ({
    name: s.pluralName,
    href: `/best/${s.slug}`,
  }));

  const businessSchema = generateLocalBusinessSchema(business);

  const stars = Array.from({ length: 5 }, (_, i) => i < Math.floor(business.rating));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      {business.image && (
        <HeroImage src={business.image} alt={business.name} />
      )}

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        {business.name}{" "}
        <span className="text-warm-400">— Liberty Village</span>
      </h1>

      {/* Rating & Meta */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="flex text-amber-500" aria-label={`${business.rating} out of 5 stars`}>
          {stars.map((filled, i) => (
            <span key={i} className={filled ? "opacity-100" : "opacity-20"}>★</span>
          ))}
        </span>
        <span className="text-sm text-warm-500">
          {business.rating} ({business.reviewCount.toLocaleString()} reviews)
        </span>
        {business.priceRange && (
          <span className="rounded-full bg-amber-50 px-3 py-0.5 text-xs font-medium text-amber-700">
            {business.priceRange}
          </span>
        )}
        {service && (
          <Link
            href={`/best/${service.slug}`}
            className="text-xs text-amber-600 hover:underline"
          >
            {service.icon} {service.pluralName}
          </Link>
        )}
      </div>

      {/* Tags */}
      <div className="mt-4 flex flex-wrap gap-2">
        {business.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-warm-100 px-3 py-1 text-xs text-warm-600"
          >
            {tag}
          </span>
        ))}
      </div>

      {business.answerBlock && (
        <AnswerBlock>{business.answerBlock}</AnswerBlock>
      )}

      {business.bestFor && business.bestFor.length > 0 && (
        <div className="mt-4">
          <span className="text-xs font-medium text-warm-400 uppercase tracking-wide">Best For</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {business.bestFor.map((use) => (
              <span key={use} className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs text-amber-700">
                {use}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Details Grid */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-warm-200 bg-white p-5 space-y-3">
          <div>
            <span className="block text-xs font-medium text-warm-400 uppercase tracking-wide">Address</span>
            <span className="text-sm text-warm-800">{business.address}</span>
          </div>
          <div>
            <span className="block text-xs font-medium text-warm-400 uppercase tracking-wide">Hours</span>
            <span className="text-sm text-warm-800">{business.hours}</span>
          </div>
          {business.phone && (
            <div>
              <span className="block text-xs font-medium text-warm-400 uppercase tracking-wide">Phone</span>
              <a
                href={`tel:${business.phone}`}
                data-analytics-event="business_contact_clicked"
                data-contact-type="phone"
                data-business-slug={business.slug}
                data-business-category={business.category}
                className="text-sm text-amber-600 hover:underline"
              >
                {business.phone}
              </a>
            </div>
          )}
          {business.website && (
            <div>
              <span className="block text-xs font-medium text-warm-400 uppercase tracking-wide">Website</span>
              <a
                href={business.website}
                target="_blank"
                rel="noopener noreferrer"
                data-analytics-event="business_contact_clicked"
                data-contact-type="website"
                data-business-slug={business.slug}
                data-business-category={business.category}
                className="text-sm text-amber-600 hover:underline truncate block"
              >
                Visit Website
              </a>
            </div>
          )}
        </div>

        {/* Description */}
        <div className="rounded-xl border border-warm-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-warm-900">
            About {business.name}
          </h2>
          <p className="mt-2 text-sm text-warm-600 leading-relaxed">
            {linkifyText(business.description, linkLookups)}
          </p>
        </div>
      </div>

      {/* Pro Tip */}
      {business.proTip && (
        <div className="mt-6 rounded-xl border-l-4 border-amber-400 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-800">
            Insider Tip
          </h2>
          <p className="mt-1 text-sm text-warm-700">{business.proTip}</p>
        </div>
      )}

      {/* Reviews — entity-specific summary (keeps brand "reviews" intent on the entity page) */}
      {business.reviewExcerpt && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-warm-900">
            {business.name} Reviews
          </h2>
          <p className="mt-2 text-sm text-warm-600 leading-relaxed">
            {business.reviewExcerpt}
          </p>
          <p className="mt-2 text-xs text-warm-400">
            Based on {business.reviewCount.toLocaleString()} reviews · {business.rating} out of 5 stars
          </p>
        </section>
      )}

      {/* Entity-specific review Q&A (rendered as page content, not the getBusinessFAQs schema block) */}
      {business.reviewFaqs && business.reviewFaqs.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold text-warm-900">
            {business.name} Reviews — Common Questions
          </h2>
          <div className="mt-4 space-y-2">
            {business.reviewFaqs.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-lg border border-warm-200 bg-white"
              >
                <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-warm-800 hover:text-amber-600 transition-colors list-none flex items-center justify-between">
                  {faq.question}
                  <span className="ml-2 text-warm-400 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <div className="px-5 pb-4 text-sm text-warm-600 leading-relaxed">
                  {faq.answer}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      <FAQSection faqs={faqs} />

      <RelatedLinks
        heading={`More ${service?.pluralName || "Businesses"} in Liberty Village`}
        links={relatedBusinesses}
      />

      {service && (
        <div className="mt-8 text-center">
          <Link
            href={`/best/${service.slug}`}
            className="text-sm font-medium text-amber-600 hover:underline"
          >
            See all {service.pluralName} in Liberty Village →
          </Link>
        </div>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(businessSchema) }}
      />
    </div>
  );
}
