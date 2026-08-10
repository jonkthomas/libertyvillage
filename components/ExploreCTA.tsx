import Link from "next/link";

export default function ExploreCTA({
  label,
  href,
  description,
}: {
  label: string;
  href: string;
  description: string;
}) {
  // Model-authored posts may populate this field. Only same-site paths are
  // allowed; never hand an arbitrary scheme or protocol-relative URL to Link.
  if (!label || !description || !/^\/(?!\/)[A-Za-z0-9/_-]*$/.test(href))
    return null;

  return (
    <div className="min-h-[80px] rounded-lg border-l-4 border-amber-500 bg-amber-50 p-6">
      <h3 className="text-lg font-semibold text-warm-800">{label}</h3>
      <p className="mt-1 text-sm text-warm-600">{description}</p>
      <Link
        href={href}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-amber-700 hover:text-amber-800 transition-colors"
      >
        Explore now
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      </Link>
    </div>
  );
}
