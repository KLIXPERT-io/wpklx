const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
};

let noColor = false;

export function setNoColor(value: boolean): void {
  noColor = value || (process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "");
}

function style(text: string, ...codes: string[]): string {
  if (noColor) return text;
  return codes.join("") + text + ANSI.reset;
}

/**
 * Renders a markdown string to ANSI-formatted terminal output.
 * Supports headings, bold, italic, code, code blocks, lists, tables, and hr.
 */
export function renderMarkdown(input: string): string {
  const lines = input.split("\n");
  const output: string[] = [];

  let inCodeBlock = false;
  let codeBlockLang = "";
  let codeBlockLines: string[] = [];

  for (const line of lines) {
    // Code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        if (codeBlockLang) {
          output.push(style(`[${codeBlockLang}]`, ANSI.dim));
        }
        for (const codeLine of codeBlockLines) {
          output.push("  " + style(codeLine, ANSI.dim));
        }
        output.push("");
        inCodeBlock = false;
        codeBlockLines = [];
        codeBlockLang = "";
      } else {
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      const width = process.stdout.columns || 80;
      output.push(style("─".repeat(width), ANSI.dim));
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const text = headingMatch[2]!;
      output.push(style(text, ANSI.bold, ANSI.underline));
      continue;
    }

    // Unordered lists
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)/);
    if (ulMatch) {
      const indent = ulMatch[1] ?? "";
      const text = renderInline(ulMatch[2]!);
      output.push(`${indent}  • ${text}`);
      continue;
    }

    // Ordered lists
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (olMatch) {
      const indent = olMatch[1] ?? "";
      const num = olMatch[2]!;
      const text = renderInline(olMatch[3]!);
      output.push(`${indent}  ${num}. ${text}`);
      continue;
    }

    // Regular text with inline formatting
    output.push(renderInline(line));
  }

  return output.join("\n");
}

/** Renders inline markdown: bold, italic, inline code */
function renderInline(text: string): string {
  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, code: string) =>
    style(code, ANSI.dim, ANSI.cyan),
  );

  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, (_, bold: string) =>
    style(bold, ANSI.bold),
  );

  // Italic
  text = text.replace(/\*([^*]+)\*/g, (_, italic: string) =>
    style(italic, ANSI.italic),
  );

  return text;
}

/**
 * Renders a data table with box-drawing characters.
 * Falls back to pipe-delimited when no-color is set.
 */
export function renderTable(
  headers: string[],
  rows: string[][],
  maxWidth?: number,
): string {
  const termWidth = maxWidth ?? process.stdout.columns ?? 120;

  if (noColor) {
    return renderPipeTable(headers, rows);
  }

  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const maxDataWidth = rows.reduce(
      (max, row) => Math.max(max, (row[i] ?? "").length),
      0,
    );
    return Math.max(h.length, maxDataWidth);
  });

  // Truncate to fit terminal width
  const totalPadding = colWidths.length * 3 + 1;
  const availableWidth = termWidth - totalPadding;
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);

  if (totalWidth > availableWidth) {
    const scale = availableWidth / totalWidth;
    for (let i = 0; i < colWidths.length; i++) {
      colWidths[i] = Math.max(4, Math.floor(colWidths[i]! * scale));
    }
  }

  const lines: string[] = [];

  // Top border
  lines.push(
    "┌" + colWidths.map((w) => "─".repeat(w + 2)).join("┬") + "┐",
  );

  // Header row
  const headerCells = headers.map((h, i) =>
    style(truncate(h, colWidths[i]!).padEnd(colWidths[i]!), ANSI.bold),
  );
  lines.push("│ " + headerCells.join(" │ ") + " │");

  // Header separator
  lines.push(
    "├" + colWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┤",
  );

  // Data rows
  for (const row of rows) {
    const cells = headers.map((_, i) =>
      truncate(row[i] ?? "", colWidths[i]!).padEnd(colWidths[i]!),
    );
    lines.push("│ " + cells.join(" │ ") + " │");
  }

  // Bottom border
  lines.push(
    "└" + colWidths.map((w) => "─".repeat(w + 2)).join("┴") + "┘",
  );

  return lines.join("\n");
}

function renderPipeTable(headers: string[], rows: string[][]): string {
  const lines: string[] = [];
  lines.push(headers.join(" | "));
  lines.push(headers.map((h) => "-".repeat(h.length)).join(" | "));
  for (const row of rows) {
    lines.push(
      headers.map((_, i) => row[i] ?? "").join(" | "),
    );
  }
  return lines.join("\n");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}
