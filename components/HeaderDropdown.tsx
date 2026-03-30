"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

export default function HeaderDropdown({
  services,
}: {
  services: Array<{ slug: string; pluralName: string }>;
}) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function handleMouseEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  }

  function handleMouseLeave() {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="text-sm font-medium text-warm-600 hover:text-amber-600 transition-colors"
        onClick={() => setOpen(!open)}
      >
        Best Of
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-warm-200 bg-white py-2 shadow-lg"
        >
          {services.map((s) => (
            <Link
              key={s.slug}
              href={`/best/${s.slug}`}
              role="menuitem"
              tabIndex={0}
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 hover:text-amber-600 transition-colors"
            >
              {s.pluralName}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
