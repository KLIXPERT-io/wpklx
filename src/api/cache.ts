import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { DiscoveredSchema } from "../types/api.ts";
import { logger } from "../helpers/logger.ts";

const CACHE_DIR = join(homedir(), ".config", "wpklx", "cache");
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

/** In-memory cache for the current session */
const memoryCache = new Map<string, DiscoveredSchema>();

function hostHash(host: string): string {
  return createHash("sha256").update(host).digest("hex").slice(0, 16);
}

function cachePath(host: string): string {
  return join(CACHE_DIR, `${hostHash(host)}.json`);
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Load schema from cache (memory first, then disk). */
export function loadCachedSchema(
  host: string,
  ttlSeconds?: number,
): DiscoveredSchema | null {
  const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;

  // Check memory cache first
  const cached = memoryCache.get(host);
  if (cached && !isExpired(cached, ttl)) {
    logger.debug("Schema loaded from memory cache");
    return cached;
  }

  // Check disk cache
  const path = cachePath(host);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf-8");
    const schema = JSON.parse(content) as DiscoveredSchema;

    if (isExpired(schema, ttl)) {
      logger.debug("Disk cache expired, will re-discover");
      return null;
    }

    logger.debug("Schema loaded from disk cache");
    memoryCache.set(host, schema);
    return schema;
  } catch {
    logger.debug("Failed to read disk cache");
    return null;
  }
}

/** Save schema to both memory and disk cache. */
export function saveSchemaCache(
  host: string,
  schema: DiscoveredSchema,
): void {
  memoryCache.set(host, schema);

  try {
    ensureCacheDir();
    writeFileSync(cachePath(host), JSON.stringify(schema, null, 2));
    logger.debug(`Schema cached to ${cachePath(host)}`);
  } catch (error) {
    logger.warn(
      `Failed to write schema cache: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isExpired(schema: DiscoveredSchema, ttlSeconds: number): boolean {
  const discoveredAt = new Date(schema.discoveredAt).getTime();
  const age = Date.now() - discoveredAt;
  return age > ttlSeconds * 1000;
}
