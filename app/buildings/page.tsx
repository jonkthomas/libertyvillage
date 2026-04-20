import Link from "next/link";
import { getAllBuildings, getBuildingsByType } from "@/lib/data";
import { generateBuildingsHubMeta } from "@/lib/meta";
import { generateCollectionPageSchema } from "@/lib/schema";
import Breadcrumbs from "@/components/Breadcrumbs";
import AnswerBlock from "@/components/AnswerBlock";

export const metadata = generateBuildingsHubMeta();

const TYPE_LABELS: Record<string, string> = {
  loft: "Lofts",
  condo: "Condos",
  rental: "Rental Buildings",
  townhouse: "Townhouses",
  mixed: "Mixed-Use",
};

const TYPE_ORDER = ["loft", "condo", "rental", "townhouse", "mixed"] as const;

const TYPE_BADGE_COLOURS: Record<string, string> = {
  loft: "bg-amber-100 text-amber-800",
  condo: "bg-blue-100 text-blue-800",
  rental: "bg-green-100 text-green-800",
  townhouse: "bg-purple-100 text-purple-800",
  mixed: "bg-warm-100 text-warm-800",
};

export default function BuildingsHubPage() {
  const allBuildings = getAllBuildings();

  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Condo Buildings Guide", href: "/buildings" },
  ];

  const collectionSchema = generateCollectionPageSchema(
    "Liberty Village Condo Buildings & Lofts Guide (2026)",
    "Every Liberty Village condo and loft building profiled: rents, amenities, reviews, and walk scores.",
    "/buildings",
    allBuildings.map((b) => ({ name: b.name, url: `/buildings/${b.slug}` }))
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Liberty Village Condo Buildings &amp; Lofts Guide{" "}
        <span className="text-warm-400">(2026)</span>
      </h1>

      <AnswerBlock>
        Liberty Village has over 50 named residential buildings ranging from
        authentic 1920s factory loft conversions to brand-new luxury condos
        completed in 2022. The neighbourhood is dominated by condos and hard
        lofts, with a smaller number of purpose-built rental buildings and the
        only townhouse cluster in the area. One-bedroom rents range from
        $2,180/month in older loft buildings to $2,680+/month in purpose-built
        rentals. All buildings are within walking distance of the 504 King
        streetcar.
      </AnswerBlock>

      <div className="mt-4 flex flex-wrap gap-2 text-sm text-warm-600">
        <span className="font-medium text-warm-800">{allBuildings.length} buildings total:</span>
        {TYPE_ORDER.map((type) => {
          const count = getBuildingsByType(type).length;
          if (count === 0) return null;
          return (
            <span key={type}>
              <a
                href={`#${type}s`}
                className="text-amber-600 hover:text-amber-700 hover:underline"
              >
                {count} {TYPE_LABELS[type]}
              </a>
            </span>
          );
        })}
      </div>

      {TYPE_ORDER.map((type) => {
        const buildings = getBuildingsByType(type);
        if (buildings.length === 0) return null;

        return (
          <section key={type} id={`${type}s`} aria-labelledby={`heading-${type}`} className="mt-12">
            <h2
              id={`heading-${type}`}
              className="text-2xl font-bold text-warm-900 border-b border-warm-200 pb-3"
            >
              {TYPE_LABELS[type]}
            </h2>
            <p className="mt-2 text-sm text-warm-500">
              {buildings.length} building{buildings.length !== 1 ? "s" : ""}
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {buildings.map((building) => (
                <Link
                  key={building.slug}
                  href={`/buildings/${building.slug}`}
                  className="group block rounded-xl border border-warm-200 bg-white p-5 transition-all hover:border-amber-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-warm-900 group-hover:text-amber-600 transition-colors">
                      {building.name}
                    </h3>
                    <span
                      className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_BADGE_COLOURS[building.buildingType]}`}
                    >
                      {building.buildingType}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-warm-500">{building.address}</p>

                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-warm-600">
                    <span>
                      <span className="font-medium text-warm-800">Built:</span>{" "}
                      {building.yearBuilt}
                    </span>
                    <span>
                      <span className="font-medium text-warm-800">1BR from:</span>{" "}
                      ${building.avgRent1BR.toLocaleString()}/mo
                    </span>
                    <span>
                      <span className="font-medium text-warm-800">Units:</span>{" "}
                      {building.units}
                    </span>
                    <span>
                      <span className="font-medium text-warm-800">Walk:</span>{" "}
                      {building.walkScore}/100
                    </span>
                  </div>

                  {building.amenities.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {building.amenities.slice(0, 3).map((amenity) => (
                        <span
                          key={amenity}
                          className="rounded-full bg-warm-100 px-2 py-0.5 text-xs text-warm-600"
                        >
                          {amenity}
                        </span>
                      ))}
                      {building.amenities.length > 3 && (
                        <span className="rounded-full bg-warm-100 px-2 py-0.5 text-xs text-warm-400">
                          +{building.amenities.length - 3} more
                        </span>
                      )}
                    </div>
                  )}

                  <span className="mt-3 inline-flex items-center text-xs font-semibold text-amber-600 group-hover:text-amber-700">
                    View profile &rarr;
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <div className="mt-12 rounded-lg border border-warm-200 bg-warm-50 p-5">
        <h2 className="text-lg font-semibold text-warm-800">About This Guide</h2>
        <p className="mt-2 text-sm text-warm-600 leading-relaxed">
          This guide covers 20 residential buildings in Liberty Village, Toronto.
          Rent figures are editorial estimates sourced from Realtor.ca, Zolo, and
          community reporting. Actual rents vary by unit, floor, and market
          conditions. For parking, always refer to the individual building&apos;s
          current status certificate and management office.
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          <Link
            href="/guide/parking-guide"
            className="text-sm font-semibold text-amber-600 hover:text-amber-700"
          >
            Parking Guide &rarr;
          </Link>
          <Link
            href="/directory"
            className="text-sm font-semibold text-amber-600 hover:text-amber-700"
          >
            Business Directory &rarr;
          </Link>
        </div>
      </div>

      {/* CollectionPage JSON-LD — emitted explicitly by the hub page */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
    </div>
  );
}
