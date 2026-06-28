import Link from "next/link";
import { generateBreadcrumbSchema } from "@/lib/schema";

export default function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  const schema = generateBreadcrumbSchema(items);

  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-warm-500">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">&gt;</span>}
              {!isLast && item.href && item.href !== "#" ? (
                <Link
                  href={item.href}
                  className="hover:text-amber-600 transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="text-warm-700 font-medium">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </nav>
  );
}
