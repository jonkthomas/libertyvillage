import { notFound } from "next/navigation";
import {
  getAllServices,
  getServiceBySlug,
  getBusinessesByCategory,
} from "@/lib/data";
import { generateServicePageMeta } from "@/lib/meta";
import {
  generateCollectionPageSchema,
  generateSpeakableSchema,
  generateItemListSchema,
} from "@/lib/schema";
import {
  getRelatedServices,
  getRelatedGuides,
  getRelatedPostsForService,
  getBreadcrumbs,
} from "@/lib/links";
import { linkifyText, type LinkEntry } from "@/lib/linkify";
import { getAllBusinesses } from "@/lib/data";
import BusinessCard from "@/components/BusinessCard";
import Breadcrumbs from "@/components/Breadcrumbs";
import HeroImage from "@/components/HeroImage";
import FAQSection from "@/components/FAQSection";
import RelatedLinks from "@/components/RelatedLinks";
import AnswerBlock from "@/components/AnswerBlock";
import ServiceComparisonTable from "@/components/ServiceComparisonTable";
import KeyTakeaways from "@/components/KeyTakeaways";
import ProTips from "@/components/ProTips";

interface Props {
  params: Promise<{ service: string }>;
}

export async function generateStaticParams() {
  const services = getAllServices();
  return services.map((s) => ({ service: s.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { service: slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) return {};
  const meta = generateServicePageMeta(service);
  // Thin pages (fewer than 3 listed businesses) offer little ranking value and
  // risk being flagged as low-quality. Keep them crawlable but out of the index.
  if (getBusinessesByCategory(slug).length < 3) {
    meta.robots = { index: false, follow: true };
  }
  return meta;
}

type FaqEntry = { question: string; answer: string };

type ServiceCategoryType =
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

// Map a service slug to a broad category type so FAQ question sets stay
// relevant (e.g. no "good for groups?" question on a dentist or locksmith page).
function getServiceCategoryType(slug: string): ServiceCategoryType {
  const groups: Record<ServiceCategoryType, string[]> = {
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
    if (slugs.includes(slug)) return type as ServiceCategoryType;
  }
  return "home-services";
}

// Get FAQs from service data (specificFaqs) with a category-aware fallback.
function getServiceFAQs(service: { pluralName: string; slug: string; specificFaqs?: FaqEntry[] }): FaqEntry[] {
  if (service.specificFaqs && service.specificFaqs.length > 0) {
    return service.specificFaqs;
  }
  const plural = service.pluralName.toLowerCase();
  const type = getServiceCategoryType(service.slug);

  const rankingQ: FaqEntry = {
    question: `What are the best ${plural} in Liberty Village, Toronto?`,
    answer: `The top-rated ${plural} in Liberty Village are listed above, chosen using Google Reviews ratings, volume of local reviews, consistency of service, and firsthand recommendations from residents. Most are located along East Liberty Street, King Street West, and Atlantic Avenue.`,
  };

  const sets: Record<ServiceCategoryType, FaqEntry[]> = {
    "food-drink": [
      rankingQ,
      {
        question: `Do ${plural} in Liberty Village take reservations or walk-ins?`,
        answer: `It varies by spot. Smaller cafes and casual ${plural} in Liberty Village are mostly walk-in, while busier dinner and weekend service often fills up — booking ahead through the venue or OpenTable is wise on Friday and Saturday nights. Check each listing above for its reservation policy.`,
      },
      {
        question: `Which ${plural} in Liberty Village are good for groups or larger parties?`,
        answer: `Several of the ${plural} listed above can seat larger groups, but Liberty Village rooms are often compact, so call ahead for parties of six or more to confirm seating and any group menu. Patios fill up fastest in summer.`,
      },
      {
        question: `What is the price range for ${plural} in Liberty Village?`,
        answer: `Prices reflect Toronto west-end norms, from $ for quick, casual options to $$$$ for premium experiences. Each listing above shows a $–$$$$ indicator; budget-friendly spots cluster near King Street West, with pricier options around Atlantic Avenue and East Liberty.`,
      },
    ],
    events: [
      rankingQ,
      {
        question: `How far in advance should you book ${plural} in Liberty Village?`,
        answer: `For peak dates (weekends, holidays, and summer), book ${plural} in Liberty Village four to eight weeks ahead; popular venues and vendors are reserved even earlier. For smaller weekday gatherings, two to three weeks is often enough. Confirm deposit and cancellation terms when you enquire.`,
      },
      {
        question: `What group sizes and event types can Liberty Village ${plural} handle?`,
        answer: `Capacity ranges widely — from intimate gatherings to larger corporate or social events. Discuss your headcount, layout, and any catering or A/V needs directly with the providers listed above, since Liberty Village spaces vary from loft-style rooms to dedicated event venues.`,
      },
      {
        question: `How much do ${plural} cost in Liberty Village?`,
        answer: `Pricing depends on guest count, date, and inclusions such as catering, staffing, or rentals. Most ${plural} in Liberty Village quote per-person or package rates — request an itemized quote so you can compare what is and is not included. The listings above show a general $–$$$$ band.`,
      },
    ],
    fitness: [
      rankingQ,
      {
        question: `Do ${plural} in Liberty Village offer free trials or drop-in passes?`,
        answer: `Many ${plural} in Liberty Village offer an introductory trial, a first free class, or single drop-in passes so you can try before committing. Policies differ, so check the listing or call ahead — trial offers are a good way to compare a few nearby options before signing up.`,
      },
      {
        question: `How much does membership cost at ${plural} in Liberty Village?`,
        answer: `Liberty Village ${plural} typically price monthly memberships in line with Toronto west-end rates, with discounts for longer commitments and higher rates for boutique or class-based formats. The listings above show a $–$$$$ guide; ask about joining fees and contract length before you commit.`,
      },
      {
        question: `When are ${plural} in Liberty Village busiest?`,
        answer: `Peak times are weekday mornings before work and the 5–8pm after-work rush, when Liberty Village's commuter crowd arrives. Midday and later evenings are quieter. If you prefer space and equipment availability, aim for off-peak hours.`,
      },
    ],
    medical: [
      rankingQ,
      {
        question: `Are ${plural} in Liberty Village accepting new patients?`,
        answer: `Availability changes often. Some ${plural} in Liberty Village welcome new patients while others maintain waitlists, so call or check the website of any clinic listed above before visiting. Asking about wait times and first-appointment requirements up front saves a wasted trip.`,
      },
      {
        question: `Do ${plural} in Liberty Village direct-bill insurance?`,
        answer: `Many ${plural} in Liberty Village offer direct billing to major insurers, but coverage and billing practices differ by provider. Confirm with the specific clinic above and have your policy details ready, since OHIP-covered and extended-health services are handled differently.`,
      },
      {
        question: `How do you book an appointment with ${plural} in Liberty Village?`,
        answer: `Most ${plural} in Liberty Village take bookings by phone or through an online portal, and some offer same-day or urgent slots. Use the contact details on each listing above; for first visits, allow extra time to complete intake and history forms.`,
      },
    ],
    beauty: [
      rankingQ,
      {
        question: `Do ${plural} in Liberty Village take walk-ins or require appointments?`,
        answer: `Most ${plural} in Liberty Village run by appointment, especially for longer services, though some keep limited walk-in slots for quick visits. Weekends and after-work hours book up fastest, so reserve ahead. Check each listing above for its booking policy.`,
      },
      {
        question: `How much do ${plural} cost in Liberty Village?`,
        answer: `Pricing reflects Toronto west-end rates and depends on the service, stylist or specialist seniority, and length of appointment. The listings above show a $–$$$$ guide; ask for a quote when booking, and confirm whether tax and tip are included.`,
      },
      {
        question: `How do you book an appointment at ${plural} in Liberty Village?`,
        answer: `Book ${plural} in Liberty Village by phone, online booking, or sometimes social media DM. New clients may be asked for a deposit on longer services. Use the contact details on each listing above, and book a week or more ahead for peak weekend slots.`,
      },
    ],
    pets: [
      rankingQ,
      {
        question: `What services do ${plural} in Liberty Village offer?`,
        answer: `Offerings among ${plural} in Liberty Village range across the listings above — from routine care and supplies to specialized appointment-based services. Check each profile for the exact services, and ask about Liberty Village-specific options like neighbourhood pickup or drop-in visits.`,
      },
      {
        question: `How much do ${plural} cost in Liberty Village?`,
        answer: `Costs vary by service type, frequency, and your pet's size or needs. Liberty Village ${plural} price in line with Toronto west-end rates; the listings above give a $–$$$$ guide. Ask about package or recurring-visit discounts when you enquire.`,
      },
      {
        question: `Do ${plural} in Liberty Village require appointments or advance booking?`,
        answer: `Many ${plural} in Liberty Village book up quickly, particularly for recurring or appointment-based services, so reserve ahead rather than relying on same-day availability. Use the contact details on each listing above to confirm scheduling and any meet-and-greet requirements.`,
      },
    ],
    professional: [
      rankingQ,
      {
        question: `Do ${plural} in Liberty Village offer free initial consultations?`,
        answer: `Many ${plural} in Liberty Village offer a brief no-cost consultation to scope your needs before quoting, though policies differ. Ask when you reach out using the contact details on each listing above, and clarify whether the consultation is free and how long it runs.`,
      },
      {
        question: `How much do ${plural} charge in Liberty Village?`,
        answer: `Fees depend on the scope and complexity of your matter and whether the provider bills hourly, by retainer, or at a flat rate. Liberty Village ${plural} price in line with Toronto west-end professionals; the listings above show a $–$$$$ guide. Request a written estimate before engaging.`,
      },
      {
        question: `What should you look for when choosing ${plural} in Liberty Village?`,
        answer: `Look for relevant credentials, experience with cases like yours, clear communication, and transparent fees. Reviews from other Liberty Village residents (reflected in the listings above) help, as does a convenient location if you expect in-person meetings.`,
      },
    ],
    workspace: [
      rankingQ,
      {
        question: `Do ${plural} in Liberty Village offer day passes or monthly memberships?`,
        answer: `Most ${plural} in Liberty Village offer flexible options — day passes, part-time plans, dedicated desks, and private offices — so you can match your budget and schedule. Check each listing above for current plan types and whether trials or tours are available.`,
      },
      {
        question: `How much do ${plural} cost in Liberty Village?`,
        answer: `Pricing scales with how much access you need, from drop-in day rates to dedicated desks and private suites. Liberty Village ${plural} price in line with Toronto west-end rates; the listings above show a $–$$$$ guide. Ask about month-to-month versus committed terms.`,
      },
      {
        question: `What amenities do ${plural} in Liberty Village offer?`,
        answer: `Common amenities at ${plural} in Liberty Village include fast Wi-Fi, meeting rooms, printing, coffee, and 24/7 access; some add phone booths, events, or parking. Confirm specifics on each listing above, and note that Liberty Village's TTC and GO access makes most spaces easy to commute to.`,
      },
    ],
    rentals: [
      rankingQ,
      {
        question: `What is the typical minimum stay for ${plural} in Liberty Village?`,
        answer: `Minimum stays vary by host and season; many ${plural} in Liberty Village require a few nights, while some cater to longer corporate or relocation stays of a month or more. Check each listing above, as Toronto's short-term-rental rules can affect availability and minimums.`,
      },
      {
        question: `How much do ${plural} cost in Liberty Village?`,
        answer: `Nightly and monthly rates depend on unit size, building amenities, and season, and reflect Liberty Village's central west-end location. The listings above give a $–$$$$ guide; factor in cleaning fees and any applicable taxes when comparing options.`,
      },
      {
        question: `What amenities do Liberty Village ${plural} include?`,
        answer: `Many ${plural} in Liberty Village are in modern condos with in-suite laundry, fast Wi-Fi, and building gyms or rooftops, plus walkable access to King West dining and TTC/GO transit. Confirm parking, pet policies, and check-in details on each listing above.`,
      },
    ],
    "home-services": [
      rankingQ,
      {
        question: `How much do ${plural} cost in Liberty Village?`,
        answer: `Costs depend on the size and scope of the job and reflect Toronto west-end rates. Liberty Village ${plural} may quote flat, hourly, or per-project pricing; the listings above show a $–$$$$ guide. Get a written estimate up front, and ask whether parts, materials, or travel are included.`,
      },
      {
        question: `Do ${plural} in Liberty Village require appointments or offer same-day service?`,
        answer: `Most ${plural} in Liberty Village work by appointment, though some accommodate urgent or same-day requests for an added fee. Booking ahead secures a preferred time. Use the contact details on each listing above to confirm availability and any service-call charges.`,
      },
      {
        question: `How do you choose a reliable ${service.pluralName.toLowerCase().replace(/s$/, "")} in Liberty Village?`,
        answer: `Look for strong, recent reviews from Liberty Village residents, clear pricing, proper licensing or insurance where relevant, and responsiveness when you first make contact. The listings above are ordered by local reputation to help you shortlist trustworthy providers.`,
      },
    ],
  };

  return sets[type];
}

export default async function ServicePage({ params }: Props) {
  const { service: slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) notFound();

  const businesses = getBusinessesByCategory(slug);
  const allBusinesses = getAllBusinesses();
  const relatedServices = getRelatedServices(slug);
  const relatedGuides = getRelatedGuides(slug);
  const relatedBlogPosts = getRelatedPostsForService(slug);

  // Build cross-link lookups for business names in descriptions
  const businessLookups: LinkEntry[] = allBusinesses
    .filter((b) => b.category === slug)
    .map((b) => ({ name: b.name, href: `/directory/${b.slug}` }));
  const breadcrumbs = getBreadcrumbs("service", `Best ${service.pluralName}`);
  const faqs = getServiceFAQs(service);
  // Categories with 3+ listings are presented as a ranked comparison; thinner
  // categories are reframed as a single recommendation (no rank badges / "how
  // we ranked" methodology), matching the noindex applied in generateMetadata.
  const isRanked = businesses.length >= 3;

  const collectionSchema = generateCollectionPageSchema(
    `Best ${service.pluralName} in Liberty Village`,
    service.description,
    `/best/${service.slug}`,
    businesses.map((b) => ({ name: b.name, url: `/directory/${b.slug}` }))
  );
  const speakableSchema = service.answerBlock
    ? generateSpeakableSchema(`/best/${service.slug}`)
    : null;
  const itemListSchema =
    businesses.length > 0
      ? generateItemListSchema(
          businesses.map((b) => ({ name: b.name, url: `/directory/${b.slug}` })),
          `Best ${service.pluralName} in Liberty Village`
        )
      : service.comparisonTable && service.comparisonTable.rows.length > 0
      ? generateItemListSchema(
          service.comparisonTable.rows.map((row) => ({
            name: row[service.comparisonTable!.columns[0]],
          })),
          `Best ${service.pluralName} in Liberty Village`
        )
      : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      {service.image && (
        <HeroImage src={service.image} alt={`Best ${service.pluralName} in Liberty Village`} />
      )}

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Best {service.pluralName} in Liberty Village{" "}
        <span className="text-warm-400">(2026 Guide)</span>
      </h1>

      {service.answerBlock && (
        <AnswerBlock>{linkifyText(service.answerBlock, businessLookups)}</AnswerBlock>
      )}

      {service.comparisonTable && service.comparisonTable.rows.length > 0 && (
        <ServiceComparisonTable
          columns={service.comparisonTable.columns}
          rows={service.comparisonTable.rows}
        />
      )}

      {service.keyTakeaways && service.keyTakeaways.length > 0 && (
        <KeyTakeaways items={service.keyTakeaways} />
      )}

      <p className="mt-4 text-warm-600 leading-relaxed">
        {linkifyText(service.description, businessLookups)} Whether you&apos;re a long-time resident or just moved
        to the neighbourhood,{" "}
        {isRanked
          ? `here are the top-rated ${service.pluralName.toLowerCase()} in Liberty Village, ranked by local reviews and community reputation.`
          : businesses.length === 1
          ? `here is our recommended ${service.name.toLowerCase()} in Liberty Village, based on local reviews and community reputation.`
          : `here are our recommended ${service.pluralName.toLowerCase()} in Liberty Village, based on local reviews and community reputation.`}
      </p>

      {service.neighbourhoodContext && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold text-warm-800">Liberty Village Neighbourhood Context</h2>
          {service.neighbourhoodContext.split("\n").filter(Boolean).map((para, i) => (
            <p key={i} className="mt-3 text-warm-600 leading-relaxed">{linkifyText(para, businessLookups)}</p>
          ))}
        </div>
      )}

      {service.sections && service.sections.length > 0 && (
        <div className="mt-8 space-y-6">
          {service.sections.map((section, i) => (
            <div key={i}>
              <h2 className="text-xl font-semibold text-warm-800">{section.heading}</h2>
              <p className="mt-2 text-warm-600 leading-relaxed">{linkifyText(section.content, businessLookups)}</p>
            </div>
          ))}
        </div>
      )}

      {service.definition && (
        <aside className="mt-4 rounded-lg border-l-4 border-sage-400 bg-sage-50 px-5 py-4">
          <p className="text-sm text-warm-600 leading-relaxed">{service.definition}</p>
        </aside>
      )}

      {/* Business List */}
      {businesses.length > 0 ? (
        <div className="mt-8 space-y-4">
          {!isRanked && (
            <h2 className="text-xl font-semibold text-warm-800">
              {businesses.length === 1
                ? `Our Recommended ${service.name}`
                : `Recommended ${service.pluralName}`}
            </h2>
          )}
          {businesses.map((business, index) => (
            <div key={business.slug} className="relative">
              {isRanked && (
                <span className="absolute -left-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white shadow-sm">
                  {index + 1}
                </span>
              )}
              <BusinessCard business={business} />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-warm-200 bg-warm-50 p-8 text-center">
          <p className="text-warm-600">
            Know a great {service.name.toLowerCase()} in Liberty Village?{" "}
            <span className="font-medium text-amber-600">Let us know!</span>
          </p>
          {relatedServices.length > 0 && (
            <p className="mt-2 text-sm text-warm-500">
              Meanwhile, check out these related categories:
            </p>
          )}
        </div>
      )}

      {service.proTips && service.proTips.length > 0 && (
        <div className="mt-8">
          <ProTips tips={service.proTips} />
        </div>
      )}

      {/* Methodology — only shown for ranked categories (3+ listings) */}
      {isRanked && (
        <div className="mt-10 rounded-lg border border-warm-200 bg-warm-50 p-5">
          <h2 className="text-lg font-semibold text-warm-800">
            How We Ranked These
          </h2>
          <p className="mt-2 text-sm text-warm-600 leading-relaxed">
            Our rankings are based on a combination of Google Reviews ratings,
            volume of local reviews, consistency of service quality, and
            firsthand recommendations from Liberty Village residents. We
            prioritize businesses that are actually located in or immediately
            serve the Liberty Village area.
          </p>
        </div>
      )}

      <FAQSection faqs={faqs} linkLookups={businessLookups} />

      <RelatedLinks heading="Related Services" links={relatedServices} />
      <RelatedLinks heading="Related Guides" links={relatedGuides} />
      <RelatedLinks heading="In-Depth Guides & Comparisons" links={relatedBlogPosts} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      {speakableSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(speakableSchema) }}
        />
      )}
      {itemListSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
        />
      )}
    </div>
  );
}
