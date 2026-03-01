type State = "default" | "paragraph" | "ul" | "ol" | "table";

function processInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-warm-800">$1</strong>')
    .replace(
      /\[([^\]]+)\]\(\(?([^)]+?)\)?\)/g,
      '<a href="$2" class="text-amber-700 underline hover:text-amber-900">$1</a>'
    );
}

function parseTableRow(row: string): string[] {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:-]+(\|[\s:-]+)+\|?$/.test(line);
}

function emitTable(rows: string[]): string {
  if (rows.length < 2) return rows.map((r) => `<p class="text-warm-600 leading-relaxed mb-4">${processInline(r)}</p>`).join("\n");

  const headers = parseTableRow(rows[0]);
  const hasSeparator = isTableSeparator(rows[1]);
  const bodyStart = hasSeparator ? 2 : 1;

  const ths = headers
    .map((h) => `<th class="px-4 py-2 text-left font-semibold text-warm-800 border-b border-warm-200 whitespace-nowrap">${processInline(h)}</th>`)
    .join("");

  const bodyRows = rows.slice(bodyStart).map((row, i) => {
    const cells = parseTableRow(row);
    const tds = cells
      .map((c) => `<td class="px-4 py-2 text-warm-600">${processInline(c)}</td>`)
      .join("");
    return `<tr class="${i % 2 === 1 ? "bg-warm-50" : ""}">${tds}</tr>`;
  });

  return [
    '<div class="overflow-x-auto my-6">',
    '<table class="min-w-full text-sm border border-warm-200 rounded-lg overflow-hidden">',
    '<thead class="bg-warm-100">',
    `<tr>${ths}</tr>`,
    "</thead>",
    '<tbody class="divide-y divide-warm-100">',
    ...bodyRows,
    "</tbody>",
    "</table>",
    "</div>",
  ].join("\n");
}

export function renderMarkdownContent(content: string): string {
  const lines = content.split("\n");
  const html: string[] = [];
  let state: State = "default";
  let tableBuffer: string[] = [];

  function closeBlock() {
    if (state === "paragraph") {
      html.push("</p>");
    } else if (state === "ul") {
      html.push("</ul>");
    } else if (state === "ol") {
      html.push("</ol>");
    } else if (state === "table") {
      html.push(emitTable(tableBuffer));
      tableBuffer = [];
    }
    state = "default";
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Headings
    if (trimmed.startsWith("### ")) {
      closeBlock();
      const text = processInline(trimmed.slice(4));
      html.push(`<h3 class="text-lg font-semibold text-warm-900 mt-6 mb-2">${text}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      closeBlock();
      const text = processInline(trimmed.slice(3));
      html.push(`<h2 class="text-xl font-semibold text-warm-900 mt-8 mb-3">${text}</h2>`);
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(trimmed)) {
      closeBlock();
      html.push('<hr class="my-8 border-t border-warm-200" />');
      continue;
    }

    // Table row (contains | delimiters)
    if (trimmed.startsWith("|") && trimmed.includes("|", 1)) {
      if (state !== "table") {
        closeBlock();
        state = "table";
        tableBuffer = [];
      }
      tableBuffer.push(trimmed);
      continue;
    }

    // If we were in a table and hit a non-table line, flush
    if (state === "table") {
      closeBlock();
    }

    // Unordered list item
    if (trimmed.startsWith("- ")) {
      if (state !== "ul") {
        closeBlock();
        html.push('<ul class="list-disc pl-6 space-y-1 mb-4 text-warm-600">');
        state = "ul";
      }
      html.push(`<li class="leading-relaxed">${processInline(trimmed.slice(2))}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = trimmed.match(/^(\d+)\.\s(.+)/);
    if (olMatch) {
      if (state !== "ol") {
        closeBlock();
        html.push('<ol class="list-decimal pl-6 space-y-1 mb-4 text-warm-600">');
        state = "ol";
      }
      html.push(`<li class="leading-relaxed">${processInline(olMatch[2])}</li>`);
      continue;
    }

    // Blank line
    if (trimmed === "") {
      closeBlock();
      continue;
    }

    // Paragraph text
    if (state !== "paragraph") {
      closeBlock();
      html.push('<p class="text-warm-600 leading-relaxed mb-4">');
      state = "paragraph";
    }
    html.push(processInline(trimmed) + " ");
  }

  closeBlock();
  return html.join("\n");
}
