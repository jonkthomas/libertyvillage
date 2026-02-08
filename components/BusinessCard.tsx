import Link from "next/link";
import Image from "next/image";
import type { Business } from "@/lib/types";

function StarRating({ rating, reviewCount }: { rating: number; reviewCount: number }) {
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.25;
  return (
    <span className="flex items-center gap-0.5 text-amber-500" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < full ? "opacity-100" : hasHalf && i === full ? "opacity-60" : "opacity-20"}>
          ★
        </span>
      ))}
      <span className="ml-1 text-sm text-warm-500">
        {rating} ({new Intl.NumberFormat("en-CA").format(reviewCount)} reviews)
      </span>
    </span>
  );
}

export default function BusinessCard({ business }: { business: Business }) {
  return (
    <Link
      href={`/directory/${business.slug}`}
      className="block rounded-xl border border-warm-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      {business.image && (
        <div className="relative mb-3 overflow-hidden rounded-lg aspect-video">
          <Image
            src={business.image}
            alt={business.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 400px"
          />
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-warm-900 truncate">
            {business.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {business.category.replace(/-/g, " ")}
            </span>
            <span className="text-sm text-warm-500">{business.priceRange}</span>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <StarRating rating={business.rating} reviewCount={business.reviewCount} />
      </div>

      <p className="mt-2 text-sm text-warm-600 line-clamp-2">
        {business.description}
      </p>

      {business.proTip && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm">
          <span className="font-medium text-amber-700">Pro tip:</span>{" "}
          <span className="text-warm-700">{business.proTip}</span>
        </div>
      )}
    </Link>
  );
}
