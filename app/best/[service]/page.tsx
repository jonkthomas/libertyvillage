import { notFound } from "next/navigation";
import {
  getAllServices,
  getServiceBySlug,
  getBusinessesByCategory,
} from "@/lib/data";
import { generateServicePageMeta } from "@/lib/meta";
import {
  generateItemListSchema,
  generateFAQSchema,
} from "@/lib/schema";
import {
  getRelatedServices,
  getRelatedGuides,
  getBreadcrumbs,
} from "@/lib/links";
import BusinessCard from "@/components/BusinessCard";
import Breadcrumbs from "@/components/Breadcrumbs";
import FAQSection from "@/components/FAQSection";
import RelatedLinks from "@/components/RelatedLinks";

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

// Service-specific FAQ data
function getServiceFAQs(serviceName: string, slug: string) {
  const faqs: Record<string, { question: string; answer: string }[]> = {
    dentists: [
      { question: `How much does a dental cleaning cost in Liberty Village?`, answer: `Most dental offices in Liberty Village charge $200-350 for a standard cleaning without insurance. Many accept major dental plans and offer direct billing. Check with individual clinics for their fee schedules.` },
      { question: `Are there emergency dentists in Liberty Village?`, answer: `Several Liberty Village dental offices offer same-day emergency appointments. Liberty Village Dental and Edition Dental both accommodate urgent cases during business hours.` },
      { question: `Do Liberty Village dentists offer weekend hours?`, answer: `Some dental offices in Liberty Village offer Saturday hours, though Sunday availability is rare. It's best to call ahead and book Saturday appointments early as they fill quickly.` },
      { question: `What's the best dentist for nervous patients in Liberty Village?`, answer: `Several Liberty Village dentists specialize in anxiety-free dentistry, offering sedation options and a gentle approach. Check reviews mentioning comfort and bedside manner.` },
    ],
    restaurants: [
      { question: `What are the best restaurants in Liberty Village?`, answer: `Liberty Village has a diverse dining scene. Top picks include Mildred's Temple Kitchen for brunch, NODO for Italian, and Impact Kitchen for healthy eating. The area has options for every budget and cuisine.` },
      { question: `Are there good patio restaurants in Liberty Village?`, answer: `Yes! Liberty Village has several great patio spots. During summer, patios along East Liberty and King West are popular. Liberty Commons at Big Rock Brewery has one of the largest patios.` },
      { question: `What's the best brunch spot in Liberty Village?`, answer: `Mildred's Temple Kitchen is the iconic LV brunch destination, famous for blueberry buttermilk pancakes. OEB Breakfast Co. is another excellent option with shorter wait times.` },
      { question: `Are there late-night restaurants in Liberty Village?`, answer: `Several restaurants and bars in Liberty Village serve food late, particularly along King Street West. Brazen Head Irish Pub and The Rec Room offer late-night menus on weekends.` },
    ],
    gyms: [
      { question: `How much do gyms cost in Liberty Village?`, answer: `Gym memberships in Liberty Village range from $30-40/month for budget gyms to $100-200/month for boutique fitness studios. GoodLife Fitness offers mid-range pricing, while Altea Active is at the premium end.` },
      { question: `Are there 24-hour gyms in Liberty Village?`, answer: `GoodLife Fitness in Liberty Village offers extended hours but not full 24/7 access. For true 24-hour access, you may need to look just outside the neighborhood.` },
      { question: `What fitness classes are available in Liberty Village?`, answer: `Liberty Village has F45 Training for HIIT, Studio Lagree for low-impact strength, Orangetheory for cardio, and several yoga studios. Most offer free trial classes.` },
      { question: `Are there outdoor fitness options in Liberty Village?`, answer: `Lamport Stadium Park and the nearby trail along the rail corridor are popular for outdoor workouts. Several trainers also run boot camps at local parks during warmer months.` },
    ],
    "short-term-rentals": [
      { question: `How much do Airbnbs cost in Liberty Village?`, answer: `Nightly rates in Liberty Village range from $80-130 for studios and budget apartments to $150-250 for townhouses with multiple bedrooms. Prices are higher during summer months and on event weekends at BMO Field. Most listings include WiFi and kitchen access.` },
      { question: `Is Liberty Village a safe neighbourhood for Airbnb guests?`, answer: `Yes. Liberty Village is a safe, well-lit residential neighbourhood popular with young professionals. The streets are active during the day and evening, with restaurants and shops along East Liberty Street and King Street West. Standard big-city precautions apply.` },
      { question: `What is the best Airbnb in Liberty Village?`, answer: `Based on guest reviews and location, the Modern Liberty Village Townhouse consistently ranks as the top-rated short-term rental in the neighbourhood. It offers a private rooftop patio, dedicated workspace, and is steps from LV's best restaurants and the King streetcar.` },
      { question: `Can I walk to BMO Field from Liberty Village Airbnbs?`, answer: `Yes. Most Liberty Village rentals are within a 5-15 minute walk of BMO Field, home to Toronto FC and the Toronto Argonauts. This makes LV one of the best areas to stay for game days without dealing with downtown traffic or expensive event parking.` },
    ],
  };

  return faqs[slug] || [
    { question: `How do I find the best ${serviceName.toLowerCase()} in Liberty Village?`, answer: `We've ranked the top ${serviceName.toLowerCase()} in Liberty Village based on local reviews, quality of service, and community reputation. Browse our list above to find the best option for your needs.` },
    { question: `How much do ${serviceName.toLowerCase()} cost in Liberty Village?`, answer: `Prices vary depending on the specific business and service level. Liberty Village generally reflects Toronto pricing. Check individual listings above for price range indicators.` },
    { question: `Are there ${serviceName.toLowerCase()} open on weekends in Liberty Village?`, answer: `Many ${serviceName.toLowerCase()} in Liberty Village offer weekend hours, though availability varies. We recommend checking the specific business hours listed on each profile.` },
    { question: `What should I look for when choosing ${serviceName.toLowerCase()} in Liberty Village?`, answer: `Consider location within the neighborhood, reviews from other locals, pricing, and whether they offer the specific services you need. Our ranked list prioritizes quality and local reputation.` },
  ];
}

export default async function ServicePage({ params }: Props) {
  const { service: slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) notFound();

  const businesses = getBusinessesByCategory(slug);
  const relatedServices = getRelatedServices(slug);
  const relatedGuides = getRelatedGuides(slug);
  const breadcrumbs = getBreadcrumbs("service", `Best ${service.pluralName}`);
  const faqs = getServiceFAQs(service.pluralName, slug);

  const itemListSchema = generateItemListSchema(
    businesses.map((b) => ({ name: b.name, url: `/directory/${b.slug}` })),
    `Best ${service.pluralName} in Liberty Village`
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Best {service.pluralName} in Liberty Village{" "}
        <span className="text-warm-400">(2026 Guide)</span>
      </h1>

      <p className="mt-4 text-warm-600 leading-relaxed">
        {service.description} Whether you&apos;re a long-time resident or just moved
        to the neighborhood, here are the top-rated {service.pluralName.toLowerCase()} in
        Liberty Village, ranked by local reviews and community reputation.
      </p>

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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
      />
    </div>
  );
}
