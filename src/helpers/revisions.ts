import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { logger } from "./logger.ts";

const REVISIONS_DIR = join(homedir(), ".config", "wpklx", "revisions");
const MAX_REVISIONS = 10;

/** Derive a filesystem-safe key from a profile name or site URL. */
function profileKey(profileName: string | undefined, host: string): string {
  if (profileName) return profileName;
  return createHash("sha256").update(host).digest("hex").slice(0, 16);
}

/** Build the directory path for a specific resource+id under a profile. */
function revisionDir(profile: string, resource: string, id: string): string {
  return join(REVISIONS_DIR, profile, resource, id);
}

/** Save a snapshot of a resource before mutation. */
export function saveRevision(
  profileName: string | undefined,
  host: string,
  resource: string,
  id: string,
  data: unknown,
): string {
  const key = profileKey(profileName, host);
  const dir = revisionDir(key, resource, id);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const filePath = join(dir, `${timestamp}.json`);

  writeFileSync(filePath, JSON.stringify(data, null, 2));
  logger.info(`Revision saved: ${filePath}`);

  pruneRevisions(dir);

  return filePath;
}

/** List revisions for a resource ID, newest first. */
export function listRevisions(
  profileName: string | undefined,
  host: string,
  resource: string,
  id: string,
): { index: number; timestamp: string; path: string }[] {
  const key = profileKey(profileName, host);
  const dir = revisionDir(key, resource, id);

  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f: string) => f.endsWith(".json"))
    .sort()
    .reverse();

  return files.map((f: string, i: number) => ({
    index: i + 1,
    timestamp: f.replace(".json", "").replace(/-(?=\d{2}-\d{2}T)/g, ":").replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3"),
    path: join(dir, f),
  }));
}

/** Load a specific revision by index (1-based, 1 = latest). */
export function loadRevision(
  profileName: string | undefined,
  host: string,
  resource: string,
  id: string,
  rev: number = 1,
): unknown {
  const revisions = listRevisions(profileName, host, resource, id);

  if (revisions.length === 0) {
    return null;
  }

  const target = revisions[rev - 1];
  if (!target) {
    return null;
  }

  const content = readFileSync(target.path, "utf-8");
  return JSON.parse(content);
}

/** Prune old revisions beyond MAX_REVISIONS, keeping newest. */
function pruneRevisions(dir: string): void {
  const files = readdirSync(dir)
    .filter((f: string) => f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length <= MAX_REVISIONS) return;

  const toRemove = files.slice(MAX_REVISIONS);
  for (const file of toRemove) {
    unlinkSync(join(dir, file));
    logger.debug(`Pruned old revision: ${file}`);
  }
}
