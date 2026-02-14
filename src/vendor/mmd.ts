/**
 * mmd.ts — Vendored and extended Markdown-to-HTML converter
 *
 * Based on mmd.js by Mathieu "p01" Henri
 * https://github.com/p01/mmd.js (MIT License)
 *
 * Extensions: tables, strikethrough, task lists, horizontal rules
 */

function escape(t: string): string {
  return Bun.escapeHTML(t);
}

function inlineEscape(s: string): string {
  return (
    escape(s)
      // images
      .replace(/!\[([^\]]*)]\(([^(]+)\)/g, '<img alt="$1" src="$2">')
      // links
      .replace(
        /\[([^\]]+)]\(([^(]+?)\)/g,
        '<a href="$2">$1</a>',
      )
      // inline code
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // strikethrough
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
      // bold
      .replace(/(\*\*|__)(?=\S)([^\r]*?\S[*_]*)\1/g, "<strong>$2</strong>")
      // italic
      .replace(/(\*|_)(?=\S)([^\r]*?\S)\1/g, "<em>$2</em>")
  );
}

/** Convert a GFM-style table block into an HTML <table>. */
function renderTable(block: string): string {
  const lines = block.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return "<p>" + inlineEscape(block) + "</p>";

  const parseRow = (row: string): string[] =>
    row
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());

  const headers = parseRow(lines[0]!);

  // Detect alignment from separator row
  const sepCells = parseRow(lines[1]!);
  const aligns: Array<"left" | "center" | "right" | ""> = sepCells.map(
    (cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return "";
    },
  );

  const alignAttr = (i: number): string =>
    aligns[i] ? ` align="${aligns[i]}"` : "";

  let html = "<table><thead><tr>";
  headers.forEach((h, i) => {
    html += `<th${alignAttr(i)}>${inlineEscape(h)}</th>`;
  });
  html += "</tr></thead><tbody>";

  for (let r = 2; r < lines.length; r++) {
    const cells = parseRow(lines[r]!);
    html += "<tr>";
    headers.forEach((_, i) => {
      html += `<td${alignAttr(i)}>${inlineEscape(cells[i] ?? "")}</td>`;
    });
    html += "</tr>";
  }

  html += "</tbody></table>";
  return html;
}

/** Detect whether a block is a GFM table (has pipe-separated header + separator). */
function isTable(block: string): boolean {
  const lines = block.split("\n");
  if (lines.length < 2) return false;
  return /^\|?.+\|.+\|?$/.test(lines[0]!.trim()) &&
    /^\|?[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)+\|?$/.test(lines[1]!.trim());
}

/** Convert a list block that may contain task-list items. */
function renderTaskList(block: string): string {
  const items = ("\n" + block)
    .split(/\n[*-] /)
    .slice(1);

  const listItems = items
    .map((item) => {
      const checked = item.startsWith("[x] ") || item.startsWith("[X] ");
      const unchecked = item.startsWith("[ ] ");
      if (checked) {
        return `<li><input type="checkbox" checked disabled> ${inlineEscape(item.slice(4))}</li>`;
      }
      if (unchecked) {
        return `<li><input type="checkbox" disabled> ${inlineEscape(item.slice(4))}</li>`;
      }
      return `<li>${inlineEscape(item)}</li>`;
    })
    .join("\n");

  return `<ul>${listItems}</ul>`;
}

/** Check if a list block contains task-list items. */
function hasTaskItems(block: string): boolean {
  return /\n[*-] \[([ xX])]\s/.test("\n" + block);
}

/**
 * Convert Markdown source to HTML.
 *
 * Supports: headings (h1–h6), bold, italic, strikethrough, links, images,
 * ordered lists, unordered lists, task lists, code blocks, blockquotes,
 * paragraphs, tables, and horizontal rules.
 */
export function markdownToHtml(src: string): string {
  let h = "";

  type RuleTuple = [RegExp, string, string, string?];

  const rules: Record<string, RuleTuple> = {
    "*": [/\n\* /, "<ul><li>", "</li></ul>"],
    "-": [/\n- /, "<ul><li>", "</li></ul>"],
    "1": [/\n[1-9]\d*\.? /, "<ol><li>", "</li></ol>"],
    " ": [/\n    /, "<pre><code>", "</code></pre>", "\n"],
    ">": [/\n> /, "<blockquote>", "</blockquote>", "\n"],
  };

  src
    .replace(/\r/g, "")
    .replace(/^\n+|\n+$/g, "")
    .replace(/\t/g, "    ")
    .split(/\n\n+/)
    .forEach((b) => {
      // Horizontal rules
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(b.trim())) {
        h += "<hr>";
        return;
      }

      // Tables
      if (isTable(b)) {
        h += renderTable(b);
        return;
      }

      // Task lists (check before generic list handling)
      const f = b[0]!;
      if ((f === "*" || f === "-") && hasTaskItems(b)) {
        h += renderTaskList(b);
        return;
      }

      // Disambiguate: `* ` / `- ` are list items, `**` or `*x` are inline formatting
      const R =
        (f === "*" || f === "-") && b[1] !== " " ? undefined : rules[f];
      if (R) {
        h += R[1] +
          ("\n" + b)
            .split(R[0])
            .slice(1)
            .map(R[3] ? escape : inlineEscape)
            .join(R[3] || "</li>\n<li>") +
          R[2];
      } else if (f === "#") {
        const level = b.indexOf(" ");
        h +=
          "<h" +
          level +
          ">" +
          inlineEscape(b.slice(level + 1)) +
          "</h" +
          level +
          ">";
      } else if (f === "<") {
        h += b;
      } else {
        h += "<p>" + inlineEscape(b) + "</p>";
      }
    });

  return h;
}
