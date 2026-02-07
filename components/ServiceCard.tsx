import Link from "next/link";
import type { Service } from "@/lib/types";

export default function ServiceCard({ service }: { service: Service }) {
  return (
    <Link
      href={`/best/${service.slug}`}
      className="group block rounded-xl border border-warm-200 bg-white p-5 shadow-sm transition-all hover:border-amber-300 hover:shadow-md"
    >
      <span className="text-3xl" role="img" aria-hidden="true">
        {service.icon}
      </span>
      <h3 className="mt-2 text-base font-semibold text-warm-900 group-hover:text-amber-600 transition-colors">
        {service.pluralName}
      </h3>
      <p className="mt-1 text-sm text-warm-500 line-clamp-2">
        {service.description}
      </p>
    </Link>
  );
}
