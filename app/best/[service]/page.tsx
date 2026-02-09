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
} from "@/lib/schema";
import {
  getRelatedServices,
  getRelatedGuides,
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
  return [
    { question: `How much do ${service.pluralName.toLowerCase()} cost in Liberty Village?`, answer: `Prices vary depending on the specific business and service level. Liberty Village generally reflects Toronto pricing. Check individual listings above for price range indicators.` },
    { question: `Are there ${service.pluralName.toLowerCase()} open on weekends in Liberty Village?`, answer: `Many ${service.pluralName.toLowerCase()} in Liberty Village offer weekend hours, though availability varies. We recommend checking the specific business hours listed on each profile.` },
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

      <p className="mt-4 text-warm-600 leading-relaxed">
        {service.description} Whether you&apos;re a long-time resident or just moved
        to the neighborhood, here are the top-rated {service.pluralName.toLowerCase()} in
        Liberty Village, ranked by local reviews and community reputation.
      </p>

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
    </div>
  );
}
