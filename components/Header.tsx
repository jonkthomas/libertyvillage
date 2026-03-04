import Link from "next/link";
import MobileNav from "./MobileNav";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/directory", label: "Directory" },
  { href: "/blog", label: "Blog" },
  { href: "/guide", label: "Guides" },
  { href: "/vs/king-west", label: "Compare" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-warm-200 bg-white/95 backdrop-blur-sm shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-xl font-bold text-warm-900">
          LibertyVillage<span className="text-amber-500">.co</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-warm-600 hover:text-amber-600 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <MobileNav />
      </div>
    </header>
  );
}
