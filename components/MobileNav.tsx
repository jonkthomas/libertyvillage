"use client";

import { useState } from "react";
import Link from "next/link";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/directory", label: "Directory" },
  { href: "/buildings", label: "Buildings" },
  { href: "/blog", label: "Blog" },
  { href: "/guide", label: "Guides" },
  { href: "/vs", label: "Compare" },
];

export default function MobileNav({
  services,
}: {
  services?: Array<{ slug: string; pluralName: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [bestOfOpen, setBestOfOpen] = useState(false);

  return (
    <div className="sm:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-warm-700"
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 border-b border-warm-200 bg-white shadow-lg">
          <nav className="flex flex-col p-4">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-3 text-warm-700 hover:bg-warm-50 transition-colors"
            >
              Home
            </Link>

            {services && services.length > 0 && (
              <div>
                <button
                  onClick={() => setBestOfOpen(!bestOfOpen)}
                  className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-warm-700 hover:bg-warm-50 transition-colors"
                  aria-expanded={bestOfOpen}
                >
                  <span>Best Of</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`transition-transform ${bestOfOpen ? "rotate-180" : ""}`}
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
                {bestOfOpen && (
                  <div className="ml-4 flex flex-col">
                    {services.map((s) => (
                      <Link
                        key={s.slug}
                        href={`/best/${s.slug}`}
                        onClick={() => setOpen(false)}
                        className="rounded-lg px-4 py-2 text-sm text-warm-600 hover:bg-warm-50 transition-colors"
                      >
                        {s.pluralName}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {navLinks.slice(1).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-3 text-warm-700 hover:bg-warm-50 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
