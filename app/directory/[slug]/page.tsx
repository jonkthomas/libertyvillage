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

function getBusinessFAQs(business: { name: string; category: string; hours: string; priceRange: string }) {
  return [
    {
      question: `What are the hours for ${business.name}?`,
      answer: `${business.name} is open ${business.hours}. Hours may vary on holidays, so it's best to call ahead to confirm.`,
    },
    {
      question: `How much does ${business.name} cost?`,
      answer: `${business.name} is rated ${business.priceRange} for pricing. This reflects typical pricing for ${business.category.replace(/-/g, " ")} in the Liberty Village area.`,
    },
    {
      question: `Is ${business.name} good for groups?`,
      answer: `${business.name} is a popular Liberty Village spot. For larger groups, we recommend calling ahead to ensure availability and check if reservations are accepted.`,
    },
  ];
}

export default async function BusinessDetailPage({ params }: Props) {
  const { slug } = await params;
  const business = getBusinessBySlug(slug);
  if (!business) notFound();

  const service = getServiceBySlug(business.category);
  const relatedBusinesses = getRelatedBusinesses(slug, business.category);
  const breadcrumbs = getBreadcrumbs("business", business.name);
  const faqs = getBusinessFAQs(business);

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
        <span className="rounded-full bg-amber-50 px-3 py-0.5 text-xs font-medium text-amber-700">
          {business.priceRange}
        </span>
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
              <a href={`tel:${business.phone}`} className="text-sm text-amber-600 hover:underline">
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
            {business.description}
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
