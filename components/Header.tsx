import Link from "next/link";
import MobileNav from "./MobileNav";
import HeaderDropdown from "./HeaderDropdown";
import { getAllServices } from "@/lib/data";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/directory", label: "Directory" },
  { href: "/buildings", label: "Buildings" },
  { href: "/blog", label: "Blog" },
  { href: "/guide", label: "Guides" },
  { href: "/vs", label: "Compare" },
];

function getTopServices() {
  const priorityMap = { high: 1, medium: 2, low: 3 } as const;
  return getAllServices()
    .sort((a, b) => {
      const pa = priorityMap[a.searchVolume] ?? 3;
      const pb = priorityMap[b.searchVolume] ?? 3;
      if (pa !== pb) return pa - pb;
      return a.pluralName.localeCompare(b.pluralName);
    })
    .slice(0, 8)
    .map((s) => ({ slug: s.slug, pluralName: s.pluralName }));
}

export default function Header() {
  const topServices = getTopServices();

  return (
    <header className="sticky top-0 z-40 border-b border-warm-200 bg-white/95 backdrop-blur-sm shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-xl font-bold text-warm-900">
          LibertyVillage<span className="text-amber-500">.co</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          <Link
            href="/"
            className="text-sm font-medium text-warm-600 hover:text-amber-600 transition-colors"
          >
            Home
          </Link>
          <HeaderDropdown services={topServices} />
          {navLinks.slice(1).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-warm-600 hover:text-amber-600 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <MobileNav services={topServices} />
      </div>
    </header>
  );
}
