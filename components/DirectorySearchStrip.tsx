"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

export default function DirectorySearchStrip() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push(query.trim() ? `/directory?q=${encodeURIComponent(query.trim())}` : "/directory");
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex max-w-xl flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <svg
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-lv-warm-grey"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search restaurants, gyms, services..."
          className="w-full rounded-xl border border-lv-sand bg-lv-white py-3.5 pl-12 pr-4 text-base text-lv-warm-black placeholder:text-lv-warm-grey/60 shadow-sm transition-colors focus:border-lv-brick focus:outline-none focus:ring-2 focus:ring-lv-brick/20"
        />
      </div>
      <div className="flex items-center justify-center gap-3">
        <button
          type="submit"
          className="whitespace-nowrap rounded-xl bg-lv-brick px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-lv-brick-dark"
        >
          Search
        </button>
        <Link
          href="/directory"
          className="whitespace-nowrap text-sm font-medium text-lv-brick hover:text-lv-brick-dark transition-colors"
        >
          Browse All &rarr;
        </Link>
      </div>
    </form>
  );
}
