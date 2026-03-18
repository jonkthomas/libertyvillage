"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import type { ReactNode } from "react";

interface CategoryCardProps {
  href: string;
  icon: ReactNode;
  name: string;
  count: number;
  index: number;
}

export default function CategoryCard({ href, icon, name, count, index }: CategoryCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: "easeOut", delay: index * 0.07 }}
    >
      <Link
        href={href}
        className="group flex flex-col items-center gap-3 rounded-2xl border border-lv-sand bg-lv-white p-6 text-center shadow-sm transition-all duration-300 hover:border-lv-brick/30 hover:shadow-md hover:-translate-y-1"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-lv-cream text-lv-brick transition-colors group-hover:bg-lv-brick group-hover:text-white">
          {icon}
        </span>
        <div>
          <h3 className="text-base font-semibold text-lv-warm-black group-hover:text-lv-brick transition-colors">
            {name}
          </h3>
          <p className="mt-0.5 text-sm text-lv-warm-grey">
            {count} {count === 1 ? "business" : "businesses"}
          </p>
        </div>
      </Link>
    </motion.div>
  );
}
