import Link from "next/link";
import type { LinkItem } from "@/lib/links";

export default function RelatedLinks({
  heading,
  links,
}: {
  heading: string;
  links: LinkItem[];
}) {
  if (links.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold text-warm-900">{heading}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg border border-warm-200 bg-white p-4 transition-colors hover:border-amber-300"
          >
            <span className="text-sm font-medium text-warm-900">
              {link.title}
            </span>
            <p className="mt-1 text-xs text-warm-500 line-clamp-2">
              {link.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
