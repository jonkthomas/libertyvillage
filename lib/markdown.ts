export function renderMarkdownContent(content: string) {
  // Simple markdown to HTML: handle ## headings, ### headings, **bold**, paragraphs
  const lines = content.split("\n");
  const html: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("### ")) {
      if (inParagraph) { html.push("</p>"); inParagraph = false; }
      html.push(`<h3 class="text-lg font-semibold text-warm-900 mt-6 mb-2">${trimmed.slice(4)}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      if (inParagraph) { html.push("</p>"); inParagraph = false; }
      html.push(`<h2 class="text-xl font-semibold text-warm-900 mt-8 mb-3">${trimmed.slice(3)}</h2>`);
    } else if (trimmed === "") {
      if (inParagraph) { html.push("</p>"); inParagraph = false; }
    } else {
      if (!inParagraph) {
        html.push(`<p class="text-warm-600 leading-relaxed mb-4">`);
        inParagraph = true;
      }
      // Handle **bold** and [links](url)
      const processed = trimmed
        .replace(
          /\*\*(.+?)\*\*/g,
          '<strong class="text-warm-800">$1</strong>'
        )
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" class="text-amber-700 underline hover:text-amber-900">$1</a>'
        );
      html.push(processed + " ");
    }
  }
  if (inParagraph) html.push("</p>");

  return html.join("\n");
}
