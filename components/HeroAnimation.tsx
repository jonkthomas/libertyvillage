"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";

interface HeroAnimationProps {
  children: ReactNode;
  className?: string;
}

export default function HeroAnimation({ children, className }: HeroAnimationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || !containerRef.current || hasAnimated.current) return;

    hasAnimated.current = true;
    const el = containerRef.current;
    const elements = el.querySelectorAll("[data-hero-animate]");
    if (elements.length === 0) return;

    const ctx = gsap.context(() => {
      gsap.set(elements, { y: 30, opacity: 0 });
      gsap.to(elements, {
        y: 0,
        opacity: 1,
        duration: 0.8,
        stagger: 0.15,
        ease: "power2.out",
        delay: 0.1,
      });
    }, el);

    return () => {
      ctx.revert();
    };
  }, []);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
