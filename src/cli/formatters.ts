import { stringify } from "yaml";
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
  if (fields === "all") {
    columns = Object.keys(data[0]!);
  } else if (fields) {
    columns = fields.split(",").map((f) => f.trim());
  } else {
    columns = selectDefaultColumns(data[0]!);
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

const MAX_DEFAULT_COLUMNS = 6;
const PREFERRED_FIELDS = ["title", "name", "slug", "status", "date", "date_gmt"];

/**
 * Selects a compact set of default columns from the first data row.
 * Excludes object/array fields and prioritizes common WordPress fields.
 */
function selectDefaultColumns(sample: Record<string, unknown>): string[] {
  const columns: string[] = [];
  const allKeys = Object.keys(sample);

  // Always include `id` first if present
  if ("id" in sample) {
    columns.push("id");
  }

  // Add preferred fields that exist and have simple values
  for (const field of PREFERRED_FIELDS) {
    if (columns.length >= MAX_DEFAULT_COLUMNS) break;
    if (field in sample && !columns.includes(field) && isSimpleValue(sample[field])) {
      columns.push(field);
    }
  }

  // Fill remaining slots from other simple-value fields
  for (const key of allKeys) {
    if (columns.length >= MAX_DEFAULT_COLUMNS) break;
    if (!columns.includes(key) && isSimpleValue(sample[key])) {
      columns.push(key);
    }
  }

  // Fallback: if nothing matched, show all keys (shouldn't happen in practice)
  return columns.length > 0 ? columns : allKeys;
}

/** Returns true if a value is a simple scalar (not an object or array). */
function isSimpleValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return false;
  if (typeof value === "object") return false;
  return true;
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

/** Filters an object/array to only include specified fields. */
function filterFields(
  data: unknown,
  fields?: string,
): unknown {
  if (!fields || fields === "all") return data;

  const keys = fields.split(",").map((f) => f.trim());

  if (Array.isArray(data)) {
    return data.map((item) => pickKeys(item as Record<string, unknown>, keys));
  }

  if (typeof data === "object" && data !== null) {
    return pickKeys(data as Record<string, unknown>, keys);
  }

  return data;
}

function pickKeys(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/** Formats data as pretty-printed JSON. */
export function formatJson(data: unknown, fields?: string): string {
  return JSON.stringify(filterFields(data, fields), null, 2);
}

/** Formats data as YAML. */
export function formatYaml(data: unknown, fields?: string): string {
  return stringify(filterFields(data, fields));
}

/** Formats data in quiet mode — just IDs, one per line. */
export function formatQuiet(data: unknown): string {
  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (typeof item === "object" && item !== null && "id" in item) {
          return String((item as { id: unknown }).id);
        }
        return String(item);
      })
      .join("\n");
  }

  if (typeof data === "object" && data !== null && "id" in data) {
    return String((data as { id: unknown }).id);
  }

  return "";
}

/** Routes data to the appropriate formatter based on format string. */
export function formatOutput(
  data: unknown,
  format: string,
  opts: { fields?: string; quiet?: boolean } = {},
): string {
  if (opts.quiet) return formatQuiet(data);

  switch (format) {
    case "json":
      return formatJson(data, opts.fields);
    case "yaml":
      return formatYaml(data, opts.fields);
    case "table":
    default: {
      const items = Array.isArray(data) ? data : [data];
      return formatTable(items as Record<string, unknown>[], opts.fields);
    }
  }
}
