import Link from "next/link";
import type { ReactNode } from "react";

export interface LinkEntry {
  name: string;
  href: string;
}

/**
 * Takes raw text and a lookup map of entity names to URLs.
 * Returns React nodes with matching names wrapped in <Link> components.
 * Only links the first occurrence of each name per text block.
 */
export function linkifyText(
  text: string,
  lookups: LinkEntry[]
): ReactNode[] {
  if (lookups.length === 0) return [text];

  // Sort by name length descending so longer names match first
  const sorted = [...lookups].sort((a, b) => b.name.length - a.name.length);

  // Build a combined regex that matches any entity name
  const escapedNames = sorted.map((l) =>
    l.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(`(${escapedNames.join("|")})`, "i");

  const parts = text.split(pattern);
  const linked = new Set<string>();
  const nodes: ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    const match = sorted.find(
      (l) => l.name.toLowerCase() === part.toLowerCase()
    );

    if (match && !linked.has(match.name.toLowerCase())) {
      linked.add(match.name.toLowerCase());
      nodes.push(
        <Link
          key={`link-${i}`}
          href={match.href}
          className="text-amber-600 hover:underline"
        >
          {part}
        </Link>
      );
    } else {
      nodes.push(part);
    }
  }

  return nodes;
}
