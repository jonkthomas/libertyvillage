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

// Elements whose text must never gain a link: existing links, headings, code.
const SKIP_TAGS = new Set(["a", "h1", "h2", "h3", "h4", "h5", "h6", "code", "pre", "script", "style"]);

/** Regex source for a name as it appears in escaped HTML text (straight or curly apostrophes). */
function htmlNamePattern(name: string): string {
  return name
    .replace(/&/g, "&amp;")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/'/g, "(?:&#39;|'|’)");
}

/**
 * Links entity names inside an HTML body string (the output of renderMarkdownContent).
 * - Only the first mention of each target is linked; targets the body already links are skipped.
 * - Never links inside <a>, headings, <code> or <pre>, and never links to `selfHref`.
 * - Matching is case-sensitive on whole words, and all-lowercase names are ignored, so
 *   generic phrases ("a good space") are not mistaken for a business.
 */
export function linkifyHtml(
  html: string,
  lookups: LinkEntry[],
  options: { selfHref?: string; maxLinks?: number } = {}
): string {
  const { selfHref, maxLinks = 15 } = options;
  const linkedHrefs = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"/gi)) linkedHrefs.add(m[1]);

  // One entry per name (the first wins), longest names first so "Cibo Wine Bar" beats "Cibo".
  const byName = new Map<string, LinkEntry>();
  for (const l of lookups) {
    if (l.href === selfHref || !/[A-Z]/.test(l.name) || l.name.length < 4) continue;
    if (!byName.has(l.name)) byName.set(l.name, l);
  }
  const candidates = [...byName.values()].sort((a, b) => b.name.length - a.name.length);
  if (candidates.length === 0) return html;

  const pattern = new RegExp(
    `(?<!\\w)(${candidates.map((l) => htmlNamePattern(l.name)).join("|")})(?![\\w])`,
    "g"
  );
  const byPattern = candidates.map((l) => ({ entry: l, re: new RegExp(`^${htmlNamePattern(l.name)}$`) }));

  let added = 0;
  const skipStack: string[] = [];
  return html
    .split(/(<[^>]+>)/)
    .map((chunk) => {
      const tag = chunk.match(/^<(\/?)([a-zA-Z0-9]+)/);
      if (tag) {
        const name = tag[2].toLowerCase();
        if (SKIP_TAGS.has(name) && !chunk.endsWith("/>")) {
          if (tag[1]) {
            const at = skipStack.lastIndexOf(name);
            if (at !== -1) skipStack.splice(at);
          } else {
            skipStack.push(name);
          }
        }
        return chunk;
      }
      if (skipStack.length > 0 || !chunk) return chunk;
      return chunk.replace(pattern, (text) => {
        const match = byPattern.find((p) => p.re.test(text))?.entry;
        if (!match || added >= maxLinks || linkedHrefs.has(match.href)) return text;
        linkedHrefs.add(match.href);
        added++;
        return `<a href="${match.href}" class="text-amber-700 underline hover:text-amber-900">${text}</a>`;
      });
    })
    .join("");
}
