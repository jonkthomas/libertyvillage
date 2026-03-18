import Link from "next/link";

const quickLinks = [
  { href: "/", label: "Home" },
  { href: "/directory", label: "Directory" },
  { href: "/blog", label: "Blog" },
  { href: "/guide/parking-guide", label: "Guides" },
];

const popularServices = [
  { href: "/best/restaurants", label: "Restaurants" },
  { href: "/best/coffee-shops", label: "Coffee Shops" },
  { href: "/best/gyms", label: "Gyms" },
  { href: "/best/dentists", label: "Dentists" },
  { href: "/best/bars", label: "Bars" },
  { href: "/best/hair-salons", label: "Hair Salons" },
];

const popularGuides = [
  { href: "/guide/parking-guide", label: "Parking Guide" },
  { href: "/guide/traffic-tips", label: "Traffic Tips" },
  { href: "/guide/moving-guide", label: "Moving Guide" },
  { href: "/blog/weekend-brunch-guide-liberty-village", label: "Brunch Guide" },
  { href: "/blog/liberty-village-fitness-guide-every-gym-compared", label: "Fitness Guide" },
  { href: "/blog/fifa-world-cup-2026-liberty-village-survival-guide", label: "World Cup Guide" },
  { href: "/guide/safety-guide", label: "Safety Guide" },
  { href: "/guide/where-to-stay", label: "Where to Stay" },
];

export default function Footer() {
  return (
    <footer className="bg-sage-600 text-white">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="text-lg font-bold">
              LibertyVillage<span className="text-amber-400">.co</span>
            </h3>
            <p className="mt-2 text-sm text-white/80 leading-relaxed">
              Your complete guide to Liberty Village, Toronto. Built by locals,
              for locals. Everything you need to know about the neighbourhood.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-white/90">
              Quick Links
            </h4>
            <ul className="mt-3 space-y-2">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/70 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-white/90">
              Popular Services
            </h4>
            <ul className="mt-3 space-y-2">
              {popularServices.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/70 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-white/90">
              Popular Guides
            </h4>
            <ul className="mt-3 space-y-2">
              {popularGuides.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/70 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/20 pt-6 flex flex-col items-center gap-2">
          <div className="flex gap-4">
            <Link href="/terms" className="text-sm text-white/60 hover:text-white transition-colors">
              Terms of Service
            </Link>
            <span className="text-white/30">|</span>
            <Link href="/privacy" className="text-sm text-white/60 hover:text-white transition-colors">
              Privacy Policy
            </Link>
          </div>
          <p className="text-sm text-white/60">
            Made with love in Liberty Village, Toronto &copy; {new Date().getFullYear()} LibertyVillage.co
          </p>
        </div>
      </div>
    </footer>
  );
}
