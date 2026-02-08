"use client";

import Link from "next/link";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:py-32">
      <p className="text-sm font-semibold text-terra-500">Error</p>
      <h1 className="mt-2 text-4xl font-bold text-warm-900 sm:text-5xl">
        Something went wrong
      </h1>
      <p className="mt-4 text-lg text-warm-500">
        An unexpected error occurred. You can try again or head back to the
        homepage.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
        <button
          onClick={reset}
          className="rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600 cursor-pointer"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-warm-300 bg-white px-6 py-3 text-sm font-semibold text-warm-700 transition-colors hover:border-amber-300 hover:text-amber-600"
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}
