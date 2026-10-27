// Shared projection for the refresh writer's self-check and trusted submit.
// Keep this leaf module usable in the narrow, read-only writer runtime.
// Intro = the body before its first `## ` section, or the first paragraph if none.
export function splitIntro(content) {
  const text = String(content ?? '');
  const heading = /^## /m.exec(text);
  const cut = heading ? heading.index : (text.indexOf('\n\n') >= 0 ? text.indexOf('\n\n') : text.length);
  return { intro: text.slice(0, cut), rest: text.slice(cut) };
}

export function refreshLintRecord(record, mode) {
  return mode === 'snippet'
    ? { slug: record?.slug, publishedAt: record?.publishedAt, title: record?.title, description: record?.description, content: splitIntro(record?.content).intro }
    : record;
}
