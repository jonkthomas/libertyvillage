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
  generateFAQSchema,
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
  return generateServicePageMeta(service);
}

// Get FAQs from service data (specificFaqs) with fallback
function getServiceFAQs(service: { pluralName: string; slug: string; specificFaqs?: { question: string; answer: string }[] }) {
  if (service.specificFaqs && service.specificFaqs.length > 0) {
    return service.specificFaqs;
  }
  const plural = service.pluralName.toLowerCase();
  return [
    {
      question: `What are the best ${plural} in Liberty Village, Toronto?`,
      answer: `The top-rated ${plural} in Liberty Village are ranked above based on Google Reviews, volume of local reviews, consistency of service, and firsthand recommendations from residents. Most cluster along East Liberty Street, King Street West, and Atlantic Ave.`,
    },
    {
      question: `How much do ${plural} cost in Liberty Village?`,
      answer: `Prices in Liberty Village reflect Toronto west-end pricing. Check individual listings above for $ to $$$$ indicators. Boutique and premium options cluster near Atlantic Ave and East Liberty; budget-friendly options are more common near King Street West.`,
    },
    {
      question: `Are there ${plural} open on weekends in Liberty Village?`,
      answer: `Most ${plural} in Liberty Village offer Saturday hours; Sunday availability varies by category. Check each business's hours listed on its individual profile. Weekend demand is highest between 10am and 2pm, so book ahead for popular options.`,
    },
    {
      question: `How do you rank ${plural} in Liberty Village?`,
      answer: `Rankings combine Google Reviews ratings, review volume, service consistency, and firsthand input from Liberty Village residents. We prioritize businesses actually located in or immediately serving Liberty Village over locations 10+ minutes away.`,
    },
  ];
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
  const faqSchema = faqs && faqs.length > 0 ? generateFAQSchema(faqs) : null;

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
        {service.description} Whether you&apos;re a long-time resident or just moved
        to the neighbourhood, here are the top-rated {service.pluralName.toLowerCase()} in
        Liberty Village, ranked by local reviews and community reputation.
      </p>

      {service.neighbourhoodContext && (
        <div className="mt-6">
          <h2 className="text-xl font-semibold text-warm-800">Liberty Village Neighbourhood Context</h2>
          {service.neighbourhoodContext.split("\n").filter(Boolean).map((para, i) => (
            <p key={i} className="mt-3 text-warm-600 leading-relaxed">{para}</p>
          ))}
        </div>
      )}

      {service.sections && service.sections.length > 0 && (
        <div className="mt-8 space-y-6">
          {service.sections.map((section, i) => (
            <div key={i}>
              <h2 className="text-xl font-semibold text-warm-800">{section.heading}</h2>
              <p className="mt-2 text-warm-600 leading-relaxed">{section.content}</p>
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
          {businesses.map((business, index) => (
            <div key={business.slug} className="relative">
              <span className="absolute -left-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white shadow-sm">
                {index + 1}
              </span>
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

      {/* Methodology */}
      {businesses.length > 0 && (
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

      <FAQSection faqs={faqs} />

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
      {faqSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      )}
    </div>
  );
}
