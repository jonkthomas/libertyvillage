import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found — Liberty Village",
  description:
    "The page you're looking for doesn't exist or has been moved. Browse Liberty Village services, directory, and guides.",
};

const helpfulLinks = [
  { href: "/", label: "Home", description: "Back to the homepage" },
  {
    href: "/best/restaurants",
    label: "Browse Restaurants",
    description: "Find the best restaurants in LV",
  },
  {
    href: "/directory",
    label: "Business Directory",
    description: "Explore all local businesses",
  },
  {
    href: "/blog",
    label: "Blog",
    description: "Neighborhood news and updates",
  },
];

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:py-32">
      <p className="text-sm font-semibold text-amber-600">404</p>
      <h1 className="mt-2 text-4xl font-bold text-warm-900 sm:text-5xl">
        Page Not Found
      </h1>
      <p className="mt-4 text-lg text-warm-500">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>

      <div className="mt-12 grid gap-4 text-left sm:grid-cols-2">
        {helpfulLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group rounded-xl border border-warm-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <h2 className="font-semibold text-warm-900 group-hover:text-amber-600 transition-colors">
              {link.label}
            </h2>
            <p className="mt-1 text-sm text-warm-500">{link.description}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10">
        <Link
          href="/"
          className="inline-block rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}
