import {
  diff_match_patch,
  DIFF_DELETE,
  DIFF_INSERT,
  DIFF_EQUAL,
  type Diff,
  type DiffMatchPatch,
  type DiffMatchPatchCtor,
} from "../vendor/diff_match_patch.ts";

const DMP = diff_match_patch as unknown as DiffMatchPatchCtor;

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function noColor(): boolean {
  return process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "";
}

function c(text: string, code: string): string {
  if (noColor()) return text;
  return `${code}${text}${RESET}`;
}

/** Fields to show with rich character-level dmp diff when changed. */
const TEXT_FIELDS = new Set(["title", "excerpt", "content", "description", "caption"]);

/** Fields that are usually noisy metadata and should never count as user changes. */
export const AUTO_FIELDS = new Set([
  "modified",
  "modified_gmt",
  "date_gmt",
  "guid",
  "_links",
  "_embedded",
  "link",
]);

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Normalise a value that may be either a raw scalar or a WP rendered/raw object
 * (e.g. `{ raw: "foo", rendered: "<p>foo</p>" }`) into a canonical comparable form.
 * Prefers `raw` when present since that's what the update endpoint accepts.
 */
export function normalizeField(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ("raw" in obj) return obj["raw"];
    if ("rendered" in obj) return obj["rendered"];
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Compute field-level changes between two resource objects. Values are
 * normalized (raw/rendered unwrapped) before comparison. Auto-managed fields
 * are always excluded.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (AUTO_FIELDS.has(key)) continue;
    const a = normalizeField(before[key]);
    const b = normalizeField(after[key]);
    if (!deepEqual(a, b)) {
      changes.push({ field: key, before: a, after: b });
    }
  }
  changes.sort((x, y) => x.field.localeCompare(y.field));
  return changes;
}

/** Compute a character-level diff using dmp with semantic cleanup. */
export function diffText(a: string, b: string): Diff[] {
  const dmp: DiffMatchPatch = new DMP();
  const diffs = dmp.diff_main(a, b);
  dmp.diff_cleanupSemantic(diffs);
  return diffs;
}

/**
 * Render a dmp diff as a colored inline string:
 *   deletions in red/strikethrough-ish, insertions in green.
 * Newlines are preserved so long content reads naturally.
 */
export function renderInlineTextDiff(a: string, b: string): string {
  const diffs = diffText(a, b);
  const parts: string[] = [];
  for (const d of diffs) {
    const op = d[0];
    const text = d[1];
    if (op === DIFF_EQUAL) {
      parts.push(c(text, DIM));
    } else if (op === DIFF_INSERT) {
      parts.push(c(text, GREEN));
    } else if (op === DIFF_DELETE) {
      parts.push(c(text, RED));
    }
  }
  return parts.join("");
}

function stringifyScalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "(unset)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isLongText(v: unknown): v is string {
  return typeof v === "string" && (v.length > 80 || v.includes("\n"));
}

/** Render a list of field changes as a git-style human diff. */
export function renderFieldDiff(changes: FieldChange[]): string {
  if (changes.length === 0) {
    return c("No changes.", DIM);
  }

  const lines: string[] = [];
  for (const { field, before, after } of changes) {
    lines.push(c(`~ ${field}`, BOLD + YELLOW));

    const textDiff = TEXT_FIELDS.has(field) || (isLongText(before) && isLongText(after));
    if (textDiff && typeof before === "string" && typeof after === "string") {
      lines.push(renderInlineTextDiff(before, after));
      lines.push("");
      continue;
    }

    // Scalars / arrays / objects: show before → after
    if (before === undefined) {
      lines.push(`  ${c("+ " + stringifyScalar(after), GREEN)}`);
    } else if (after === undefined) {
      lines.push(`  ${c("- " + stringifyScalar(before), RED)}`);
    } else {
      const b = stringifyScalar(before);
      const a = stringifyScalar(after);
      if (b.length + a.length < 120 && !b.includes("\n") && !a.includes("\n")) {
        lines.push(`  ${c("- " + b, RED)}`);
        lines.push(`  ${c("+ " + a, GREEN)}`);
      } else {
        const bb = JSON.stringify(before, null, 2).split("\n");
        const aa = JSON.stringify(after, null, 2).split("\n");
        for (const line of bb) lines.push(`  ${c("- " + line, RED)}`);
        for (const line of aa) lines.push(`  ${c("+ " + line, GREEN)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Short one-liner summary, used above the detailed diff. */
export function summarizeChanges(changes: FieldChange[]): string {
  if (changes.length === 0) return c("No changes", DIM);
  const names = changes.map((c) => c.field).join(", ");
  return c(`${changes.length} field${changes.length === 1 ? "" : "s"} changed: `, CYAN) + names;
}
