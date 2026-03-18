"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

interface Stat {
  value: string;
  label: string;
  numericValue: number;
  prefix?: string;
  suffix?: string;
}

const STATS: Stat[] = [
  { value: "9,000+", label: "Residents", numericValue: 9000, suffix: "+" },
  { value: "600+", label: "Businesses", numericValue: 600, suffix: "+" },
  { value: "70%", label: "Young Professionals", numericValue: 70, suffix: "%" },
  { value: "$99K", label: "Median Income", numericValue: 99, prefix: "$", suffix: "K" },
];

function formatNumber(n: number): string {
  return n.toLocaleString("en-CA");
}

export default function AnimatedStats() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);
  const [displayValues, setDisplayValues] = useState<string[]>(
    STATS.map((s) => s.value)
  );

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || hasAnimated.current) return;

    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || hasAnimated.current) return;
        observer.disconnect();
        hasAnimated.current = true;

        STATS.forEach((stat, idx) => {
          const obj = { val: 0 };
          gsap.to(obj, {
            val: stat.numericValue,
            duration: 1.6,
            ease: "power2.out",
            onUpdate() {
              const rounded = Math.round(obj.val);
              const formatted = `${stat.prefix ?? ""}${formatNumber(rounded)}${stat.suffix ?? ""}`;
              setDisplayValues((prev) => {
                const next = [...prev];
                next[idx] = formatted;
                return next;
              });
            },
          });
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative z-10 mx-auto -mt-12 max-w-5xl rounded-2xl bg-lv-white/95 px-6 py-6 shadow-lg backdrop-blur-sm border border-lv-sand sm:px-10 sm:py-8"
    >
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-8">
        {STATS.map((stat, idx) => (
          <div key={stat.label} className="text-center">
            <span className="block font-display text-2xl font-bold text-lv-brick sm:text-3xl">
              {displayValues[idx]}
            </span>
            <span className="mt-1 block text-sm text-lv-warm-grey">{stat.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
