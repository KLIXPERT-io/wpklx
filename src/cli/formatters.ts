import { renderTable } from "./output.ts";

/**
 * Formats an array of objects as a terminal table.
 * Auto-detects columns from keys of the first object.
 */
export function formatTable(
  data: Record<string, unknown>[],
  fields?: string,
): string {
  if (data.length === 0) return "No results found.";

  // Determine columns
  let columns: string[];
  if (fields) {
    columns = fields.split(",").map((f) => f.trim());
  } else {
    columns = Object.keys(data[0]!);
  }

  // Build rows
  const rows = data.map((item) =>
    columns.map((col) => {
      const value = item[col];
      return flattenValue(value);
    }),
  );

  return renderTable(columns, rows);
}

/** Flattens a value for table display. */
function flattenValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);

  // Handle WordPress rendered content objects like { rendered: "..." }
  if (typeof value === "object" && value !== null && "rendered" in value) {
    const rendered = (value as { rendered: unknown }).rendered;
    if (typeof rendered === "string") {
      // Strip HTML tags
      return rendered.replace(/<[^>]+>/g, "").trim();
    }
  }

  // Arrays: show count
  if (Array.isArray(value)) return `[${value.length} items]`;

  // Objects: JSON summary
  return JSON.stringify(value);
}
