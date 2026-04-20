import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllBuildings, getBuildingBySlug, getBusinessBySlug } from "@/lib/data";
import { generateBuildingPageMeta } from "@/lib/meta";
import { generateApartmentComplexSchema, generateSpeakableSchema } from "@/lib/schema";
import { getRelatedBuildings } from "@/lib/links";
import Breadcrumbs from "@/components/Breadcrumbs";
import AnswerBlock from "@/components/AnswerBlock";
import KeyTakeaways from "@/components/KeyTakeaways";
import ProTips from "@/components/ProTips";
import FAQSection from "@/components/FAQSection";
import RelatedLinks from "@/components/RelatedLinks";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllBuildings().map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const building = getBuildingBySlug(slug);
  if (!building) return {};
  return generateBuildingPageMeta(building);
}

const TYPE_BADGE_COLOURS: Record<string, string> = {
  loft: "bg-amber-100 text-amber-800",
  condo: "bg-blue-100 text-blue-800",
  rental: "bg-green-100 text-green-800",
  townhouse: "bg-purple-100 text-purple-800",
  mixed: "bg-warm-100 text-warm-800",
};

export default async function BuildingDetailPage({ params }: Props) {
  const { slug } = await params;
  const building = getBuildingBySlug(slug);
  if (!building) notFound();

  const nearestBusinesses = building.nearestBusinessSlugs
    .map((s) => getBusinessBySlug(s))
    .filter((b): b is NonNullable<typeof b> => b !== undefined);

  const relatedBuildings = getRelatedBuildings(building.slug, building.buildingType);

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Buildings Guide", href: "/buildings" },
    { label: building.name, href: "#" },
  ];

  const apartmentComplexSchema = generateApartmentComplexSchema(building);
  const speakableSchema = generateSpeakableSchema(`/buildings/${building.slug}`);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* a. Breadcrumbs — emits its own BreadcrumbList JSON-LD */}
      <Breadcrumbs items={breadcrumbs} />

      {/* b. H1 */}
      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        {building.name}{" "}
        <span className="text-warm-500 text-2xl font-normal">
          — {building.address} Liberty Village Condos
        </span>
      </h1>

      {/* c. AnswerBlock */}
      <AnswerBlock>{building.answerBlock}</AnswerBlock>

      {/* d. KeyTakeaways */}
      {building.keyTakeaways.length > 0 && (
        <KeyTakeaways items={building.keyTakeaways} />
      )}

      {/* e. Quick facts grid */}
      <section className="mt-8" aria-labelledby="quick-facts-heading">
        <h2 id="quick-facts-heading" className="text-xl font-semibold text-warm-800">
          Quick Facts
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Year Built", value: building.yearBuilt.toString() },
            { label: "Total Units", value: building.units.toString() },
            { label: "Floors", value: building.floors.toString() },
            {
              label: "Type",
              value: building.buildingType.charAt(0).toUpperCase() + building.buildingType.slice(1),
            },
            { label: "1BR Avg Rent", value: `$${building.avgRent1BR.toLocaleString()}/mo` },
            { label: "2BR Avg Rent", value: `$${building.avgRent2BR.toLocaleString()}/mo` },
            { label: "Walk Score", value: `${building.walkScore}/100` },
            { label: "Transit Score", value: `${building.transitScore}/100` },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-warm-200 bg-white px-4 py-3"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-warm-500">
                {label}
              </p>
              <p className="mt-1 text-base font-semibold text-warm-900">{value}</p>
            </div>
          ))}
        </div>

        {building.developer && (
          <p className="mt-3 text-sm text-warm-500">
            <span className="font-medium text-warm-700">Developer:</span>{" "}
            {building.developer}
          </p>
        )}
        {building.maintenanceFeePerSqft && building.buildingType !== "rental" && (
          <p className="mt-1 text-sm text-warm-500">
            <span className="font-medium text-warm-700">Maintenance Fee:</span>{" "}
            ~${building.maintenanceFeePerSqft}/sqft/month
          </p>
        )}
      </section>

      {/* f. Amenities grid */}
      <section className="mt-8" aria-labelledby="amenities-heading">
        <h2 id="amenities-heading" className="text-xl font-semibold text-warm-800">
          Amenities
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {building.amenities.map((amenity) => (
            <span
              key={amenity}
              className="rounded-full border border-warm-200 bg-white px-3 py-1 text-sm text-warm-700"
            >
              {amenity}
            </span>
          ))}
          {building.hasParking && (
            <span className="rounded-full border border-warm-200 bg-white px-3 py-1 text-sm text-warm-700">
              Parking Available
            </span>
          )}
          {building.hasLockers && (
            <span className="rounded-full border border-warm-200 bg-white px-3 py-1 text-sm text-warm-700">
              Storage Lockers
            </span>
          )}
          {building.petFriendly && (
            <span className="rounded-full border border-green-100 bg-green-50 px-3 py-1 text-sm text-green-700">
              Pet Friendly
            </span>
          )}
          {!building.petFriendly && (
            <span className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-sm text-red-700">
              No Pets
            </span>
          )}
        </div>

        <span
          className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-medium ${TYPE_BADGE_COLOURS[building.buildingType]}`}
        >
          {building.buildingType.charAt(0).toUpperCase() + building.buildingType.slice(1)}
        </span>
      </section>

      {/* g. CONDITIONAL SECTION by buildingType */}
      {building.buildingType === "loft" && (
        <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-6" aria-labelledby="industrial-heritage-heading">
          <h2 id="industrial-heritage-heading" className="text-xl font-semibold text-amber-800">
            Industrial Heritage
          </h2>
          <div className="mt-3 space-y-3 text-sm text-warm-700 leading-relaxed">
            <p>
              {building.name} was converted from an original industrial building, retaining the
              authentic character — exposed brick walls, heavy timber structural beams, and
              factory-original windows — that makes Liberty Village lofts unique in the Toronto
              market. Unlike &quot;soft lofts&quot; which mimic the aesthetic in new construction,
              hard loft conversions like this one preserve genuine manufacturing heritage.
            </p>
            <p>
              The original building date of {building.yearBuilt} reflects the timeline of Liberty
              Village&apos;s transformation from a post-industrial district into Toronto&apos;s
              most creative residential neighbourhood. Maintenance fees at loft buildings are
              typically slightly higher than comparable new towers, reflecting the cost of
              maintaining heritage building envelopes.
            </p>
            <p>
              Residents of {building.name} should note that heritage loft construction
              typically means concrete slab between floors (excellent sound isolation), but
              original HVAC systems may be older than in recently built towers. Request the
              most recent building envelope and HVAC inspection reports before purchasing.
            </p>
          </div>
        </section>
      )}

      {(building.buildingType === "condo" || building.buildingType === "mixed") && (
        <section className="mt-8 rounded-xl border border-blue-200 bg-blue-50 p-6" aria-labelledby="condo-corp-heading">
          <h2 id="condo-corp-heading" className="text-xl font-semibold text-blue-800">
            Condo Corporation
          </h2>
          <div className="mt-3 space-y-3 text-sm text-warm-700 leading-relaxed">
            <p>
              {building.name} is governed by a registered Ontario condo corporation under the
              Condominium Act, 1998. Unit owners are members of the condo corporation and pay
              monthly maintenance fees to cover building insurance, common area maintenance,
              reserve fund contributions, and shared utilities.
            </p>
            {building.maintenanceFeePerSqft && (
              <p>
                Current maintenance fees run approximately ${building.maintenanceFeePerSqft}/sqft/month.
                For a typical 600 sqft one-bedroom unit, this represents approximately $
                {Math.round(building.maintenanceFeePerSqft * 600)}/month. Buyers should always
                request a current status certificate to verify maintenance fee amounts, reserve
                fund balance, any pending special assessments, and any existing by-laws that
                restrict use (rental restrictions, pet policies, smoking policies).
              </p>
            )}
            <p>
              The condo corporation at {building.name} is responsible for building HVAC, elevator
              maintenance, roof, windows, common corridors, and parking structure. Individual
              unit owners are responsible for their own interior finishes, appliances, and in-suite
              plumbing and electrical. For major building decisions, owners attend the Annual General
              Meeting (AGM) to vote on budgets, board elections, and special resolutions.
            </p>
          </div>
        </section>
      )}

      {(building.buildingType === "rental" || building.buildingType === "mixed") && (
        <section className="mt-8 rounded-xl border border-green-200 bg-green-50 p-6" aria-labelledby="tenant-rights-heading">
          <h2 id="tenant-rights-heading" className="text-xl font-semibold text-green-800">
            Tenant Rights
          </h2>
          <div className="mt-3 space-y-3 text-sm text-warm-700 leading-relaxed">
            <p>
              {building.name} is a purpose-built rental building governed by Ontario&apos;s
              Residential Tenancies Act (RTA). Unlike investor-owned condo units, which are rented
              at the individual landlord&apos;s discretion, purpose-built rentals like this one
              operate under professional management with consistent policies applied across all units.
            </p>
            <p>
              Under the RTA, tenants at {building.name} are entitled to: annual rent increases
              limited to the provincial rent increase guideline (2.5% for 2026); the right to
              reasonable maintenance and repair; access to the Landlord and Tenant Board (LTB) for
              dispute resolution; and protection against eviction except for defined legal grounds
              including non-payment of rent, substantial interference with the enjoyment of others,
              or landlord&apos;s own use of the unit.
            </p>
            <p>
              To submit a maintenance request at {building.name}, use the building&apos;s online
              portal or contact building management in writing. The landlord is legally required to
              respond to urgent maintenance requests within 24 hours and routine requests within a
              reasonable time. Document all requests in writing for LTB purposes.
            </p>
          </div>
        </section>
      )}

      {building.buildingType === "townhouse" && (
        <section className="mt-8 rounded-xl border border-purple-200 bg-purple-50 p-6" aria-labelledby="street-living-heading">
          <h2 id="street-living-heading" className="text-xl font-semibold text-purple-800">
            Street-Level Living
          </h2>
          <div className="mt-3 space-y-3 text-sm text-warm-700 leading-relaxed">
            <p>
              {building.name} offers a townhouse format that is unique in Liberty Village — a
              neighbourhood dominated by high-rise condo towers and loft buildings. The
              street-level entrance gives each unit an individual residential identity, with
              residents accessing their home directly from the street rather than through a shared
              lobby and elevator system.
            </p>
            <p>
              Each unit at {building.name} has a private entrance and private patio space, which
              is particularly valued by families, large-breed dog owners, and residents who prefer
              a more traditional house-style living environment. The three-storey format means
              residents navigate internal stairs between floors — there are no elevators, which also
              means no elevator wait times and no shared mechanical floor space to maintain.
            </p>
            <p>
              Parking is included per unit in the building&apos;s garage — a significant advantage
              in a neighbourhood where parking is scarce and expensive. The townhome format also
              means reduced maintenance fees compared to towers with extensive shared infrastructure,
              and a quieter, more intimate community dynamic than a 300-unit condo building.
            </p>
          </div>
        </section>
      )}

      {/* h. Nearest businesses */}
      {nearestBusinesses.length > 0 && (
        <section className="mt-8" aria-labelledby="nearest-businesses-heading">
          <h2 id="nearest-businesses-heading" className="text-xl font-semibold text-warm-800">
            Nearest Local Businesses
          </h2>
          <p className="mt-1 text-sm text-warm-500">
            Services and amenities within walking distance of {building.name}.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {nearestBusinesses.map((business) => (
              <Link
                key={business.slug}
                href={`/directory/${business.slug}`}
                className="group flex items-start gap-3 rounded-lg border border-warm-200 bg-white p-4 transition-colors hover:border-amber-300"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-warm-900 group-hover:text-amber-600 transition-colors truncate">
                    {business.name}
                  </p>
                  <p className="text-xs text-warm-500 mt-0.5">{business.category}</p>
                  {business.rating > 0 && (
                    <p className="text-xs text-warm-500 mt-0.5">
                      {business.rating} &#9733; ({business.reviewCount} reviews)
                    </p>
                  )}
                </div>
                <span className="flex-shrink-0 text-xs font-medium text-amber-600 group-hover:text-amber-700">
                  View &rarr;
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* i. Transit info */}
      <section className="mt-8" aria-labelledby="transit-heading">
        <h2 id="transit-heading" className="text-xl font-semibold text-warm-800">
          Transit
        </h2>
        <div className="mt-3 rounded-lg border border-warm-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
              TTC
            </div>
            <div>
              <p className="text-sm font-medium text-warm-800">{building.nearestTTC}</p>
              <p className="mt-1 text-xs text-warm-500">
                Walk Score: {building.walkScore} &middot; Transit Score:{" "}
                {building.transitScore} &middot; Bike Score: {building.bikeScore}
              </p>
            </div>
          </div>
          <div className="mt-3 text-xs text-warm-500">
            <Link
              href="/guide/parking-guide"
              className="text-amber-600 hover:text-amber-700 hover:underline font-medium"
            >
              Liberty Village parking guide &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* j. ProTips */}
      {building.proTips.length > 0 && (
        <div className="mt-8">
          <ProTips tips={building.proTips} />
        </div>
      )}

      {/* k. Pros/Cons — inline two-column list */}
      <section className="mt-8" aria-labelledby="pros-cons-heading">
        <h2 id="pros-cons-heading" className="text-xl font-semibold text-warm-800">
          Pros &amp; Cons
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-green-700">
              Pros
            </h3>
            <ul className="mt-2 space-y-2">
              {building.pros.map((pro) => (
                <li key={pro} className="flex items-start gap-2 text-sm text-warm-700">
                  <span className="mt-0.5 flex-shrink-0 text-green-500">&#10003;</span>
                  {pro}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-red-700">
              Cons
            </h3>
            <ul className="mt-2 space-y-2">
              {building.cons.map((con) => (
                <li key={con} className="flex items-start gap-2 text-sm text-warm-700">
                  <span className="mt-0.5 flex-shrink-0 text-red-400">&#10007;</span>
                  {con}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* l. FAQSection — auto-emits FAQPage schema */}
      <FAQSection
        faqs={building.specificFaqs}
        heading={`${building.name} — Frequently Asked Questions`}
      />

      {/* m. Related buildings */}
      {relatedBuildings.length > 0 && (
        <RelatedLinks
          heading={`Similar ${building.buildingType.charAt(0).toUpperCase() + building.buildingType.slice(1)} Buildings`}
          links={relatedBuildings}
        />
      )}

      <div className="mt-8">
        <Link
          href="/buildings"
          className="text-sm font-semibold text-amber-600 hover:text-amber-700"
        >
          &larr; All Liberty Village Buildings
        </Link>
      </div>

      {/* ApartmentComplex schema — emitted explicitly by page */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(apartmentComplexSchema) }}
      />
      {/* Speakable schema — emitted explicitly by page */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(speakableSchema) }}
      />
      {/* NOTE: BreadcrumbList is emitted by <Breadcrumbs /> above — not duplicated here */}
      {/* NOTE: FAQPage is emitted by <FAQSection /> above — not duplicated here */}
    </div>
  );
}
