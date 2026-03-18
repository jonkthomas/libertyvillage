"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { Business, Service } from "@/lib/types";
import BusinessCard from "./BusinessCard";

export default function DirectoryFilter({
  businesses,
  categories,
}: {
  businesses: Business[];
  categories: Service[];
}) {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");

  // Read ?q= param from URL on mount and when it changes
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setSearch(q);
  }, [searchParams]);
  const [activeCategory, setActiveCategory] = useState("");

  const filtered = useMemo(() => {
    let result = businesses;

    if (activeCategory) {
      result = result.filter((b) => b.category === activeCategory);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    return result.sort((a, b) => b.rating - a.rating);
  }, [businesses, search, activeCategory]);

  // Only show categories that have businesses
  const availableCategories = categories.filter((c) =>
    businesses.some((b) => b.category === c.slug)
  );

  return (
    <div>
      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search businesses..."
          className="w-full rounded-xl border border-warm-300 bg-white px-4 py-3 pl-10 text-sm text-warm-800 placeholder:text-warm-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-warm-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="8" strokeWidth="2" />
          <path d="m21 21-4.35-4.35" strokeWidth="2" />
        </svg>
      </div>

      {/* Category Filter Pills */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveCategory("")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            activeCategory === ""
              ? "bg-amber-500 text-white"
              : "bg-warm-100 text-warm-600 hover:bg-warm-200"
          }`}
        >
          All
        </button>
        {availableCategories.map((cat) => (
          <button
            key={cat.slug}
            onClick={() =>
              setActiveCategory(activeCategory === cat.slug ? "" : cat.slug)
            }
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              activeCategory === cat.slug
                ? "bg-amber-500 text-white"
                : "bg-warm-100 text-warm-600 hover:bg-warm-200"
            }`}
          >
            {cat.icon} {cat.pluralName}
          </button>
        ))}
      </div>

      {/* Count */}
      <p className="mt-4 text-sm text-warm-500">
        Showing {filtered.length} of {businesses.length} businesses
      </p>

      {/* Results Grid */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {filtered.map((business) => (
          <BusinessCard key={business.slug} business={business} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mt-8 rounded-xl bg-warm-50 p-8 text-center">
          <p className="text-warm-500">
            No businesses found matching your search. Try a different term or
            clear filters.
          </p>
        </div>
      )}
    </div>
  );
}
