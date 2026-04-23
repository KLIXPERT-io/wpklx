import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, basename, join, extname } from "node:path";
import { WpClient } from "../api/client.ts";
import { mapRoutesToCommands, resolveNamespacePrefix } from "../api/schema.ts";
import type { CommandMeta } from "../api/schema.ts";
import { discoverSchema } from "../api/discovery.ts";
import { loadCachedSchema, saveSchemaCache } from "../api/cache.ts";
import type { ResolvedConfig } from "../types/config.ts";
import type { ParsedArgs } from "../types/cli.ts";
import { CliError, ExitCode } from "./error.ts";
import { logger } from "./logger.ts";
import {
  diffFields,
  renderFieldDiff,
  summarizeChanges,
  normalizeField,
  AUTO_FIELDS,
  type FieldChange,
} from "./diff.ts";

interface ResourceRoutes {
  get: CommandMeta;
  update: CommandMeta;
}

async function getSchemaCached(config: ResolvedConfig) {
  return (
    loadCachedSchema(config.host, config.cache_ttl) ??
    (await discoverAndCache(config))
  );
}

async function discoverAndCache(config: ResolvedConfig) {
  const schema = await discoverSchema(config);
  saveSchemaCache(config.host, schema);
  return schema;
}

/** Look up get+update routes for a resource (honours namespace prefix). */
async function resolveResourceRoutes(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<ResourceRoutes> {
  const schema = await getSchemaCached(config);

  let namespaceFilter: string | undefined;
  if (parsed.namespacePrefix) {
    namespaceFilter =
      resolveNamespacePrefix(schema.namespaces, parsed.namespacePrefix) ?? undefined;
  }

  const commands = mapRoutesToCommands(schema, namespaceFilter);
  const resourceCommands = commands[parsed.resource];
  if (!resourceCommands) {
    throw new CliError(
      `Unknown resource: ${parsed.resource}.`,
      ExitCode.NOT_FOUND,
    );
  }
  const get = resourceCommands["get"];
  const update = resourceCommands["update"];
  if (!get || !update) {
    throw new CliError(
      `Resource '${parsed.resource}' does not support both get and update — pull/push require both.`,
      ExitCode.VALIDATION,
    );
  }
  return { get, update };
}

function expandPath(path: string, id: string): string {
  return path
    .replace(/\/\(\?P<id>[^)]+\)/, `/${id}`)
    .replace(/\/\(\?P<[^>]+>[^)]+\)/g, "");
}

/** Default working file path for a resource/id pair, in the current directory. */
function defaultFilePath(resource: string, id: string): string {
  return `${resource}-${id}.json`;
}

/** Sidecar baseline path for a given working file. */
function baselinePath(filePath: string): string {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  return join(dir, `.${base}.baseline${ext || ".json"}`);
}

interface WorkingFile {
  path: string;
  baselinePath: string;
  resource: string;
  id: string;
  data: Record<string, unknown>;
  baseline: Record<string, unknown>;
}

/**
 * Metadata we embed alongside the user's data so that `push`/`diff` can
 * resolve resource+id without extra flags. Kept under `_wpklx` so any
 * regular WP field is still accepted verbatim.
 */
interface WpklxMeta {
  resource: string;
  id: string;
  profile?: string;
  host: string;
  pulled_at: string;
}

type FileShape = Record<string, unknown> & { _wpklx?: WpklxMeta };

function readFileShape(path: string): FileShape {
  if (!existsSync(path)) {
    throw new CliError(
      `File not found: ${path}`,
      ExitCode.NOT_FOUND,
    );
  }
  const raw = readFileSync(path, "utf-8");
  try {
    return JSON.parse(raw) as FileShape;
  } catch (err) {
    throw new CliError(
      `Invalid JSON in ${path}: ${(err as Error).message}`,
      ExitCode.VALIDATION,
    );
  }
}

/** Strip local-only meta before sending anything to the API. */
function stripMeta(obj: FileShape): Record<string, unknown> {
  const { _wpklx: _ignore, ...rest } = obj;
  void _ignore;
  return rest;
}

function loadWorkingFile(filePath: string): WorkingFile {
  const data = readFileShape(filePath);
  const meta = data._wpklx;
  if (!meta) {
    throw new CliError(
      `Missing _wpklx metadata in ${filePath}.\n\n` +
        `This file was not created by 'wpklx <resource> pull'. Re-pull the resource first.`,
      ExitCode.VALIDATION,
    );
  }
  const basePath = baselinePath(filePath);
  if (!existsSync(basePath)) {
    throw new CliError(
      `Baseline not found: ${basePath}\n\n` +
        `Re-pull the resource to recreate the baseline, or use --force to push without conflict checks.`,
      ExitCode.NOT_FOUND,
    );
  }
  const baselineRaw = JSON.parse(readFileSync(basePath, "utf-8")) as FileShape;
  return {
    path: filePath,
    baselinePath: basePath,
    resource: meta.resource,
    id: meta.id,
    data: stripMeta(data),
    baseline: stripMeta(baselineRaw),
  };
}

/** Fetch a resource with context=edit so we get raw (not rendered) fields. */
async function fetchForEdit(
  client: WpClient,
  routes: ResourceRoutes,
  id: string,
): Promise<Record<string, unknown>> {
  const apiPath = expandPath(routes.get.path, id);
  const response = await client.get(apiPath, { context: "edit" });
  return response.data as Record<string, unknown>;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// -------------------- PULL --------------------

export async function handlePull(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  if (!parsed.id) {
    throw new CliError(
      `'pull' requires an ID.\n\n` +
        `Usage:\n` +
        `  wpklx ${parsed.resource} pull <id>\n` +
        `  wpklx ${parsed.resource} pull <id> --file draft.json`,
      ExitCode.VALIDATION,
    );
  }

  const routes = await resolveResourceRoutes(config, parsed);
  const client = new WpClient(config);
  const remote = await fetchForEdit(client, routes, parsed.id);

  const fileOpt = parsed.options["file"];
  const targetPath =
    typeof fileOpt === "string" && fileOpt !== ""
      ? fileOpt
      : defaultFilePath(parsed.resource, parsed.id);

  const meta: WpklxMeta = {
    resource: parsed.resource,
    id: parsed.id,
    profile: config.profile_name ?? undefined,
    host: config.host,
    pulled_at: new Date().toISOString(),
  };

  // Strip auto-managed fields from the user-facing file to reduce noise,
  // but keep them in the baseline so conflict detection stays accurate.
  const userFacing: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(remote)) {
    if (!AUTO_FIELDS.has(k)) userFacing[k] = v;
  }

  const userShape: FileShape = { _wpklx: meta, ...userFacing };

  writeJson(targetPath, userShape);
  writeJson(baselinePath(targetPath), { _wpklx: meta, ...remote });
  logger.info(
    `Pulled ${parsed.resource} ${parsed.id} → ${targetPath} ` +
      `(baseline: ${baselinePath(targetPath)})`,
  );
}

// -------------------- DIFF --------------------

export async function handleDiff(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  const fileOpt = parsed.options["file"];
  if (typeof fileOpt !== "string" || fileOpt === "") {
    throw new CliError(
      `'diff' requires --file <path>.\n\n` +
        `Usage:\n` +
        `  wpklx ${parsed.resource} diff --file post-42.json\n` +
        `  wpklx ${parsed.resource} diff --file post-42.json --server`,
      ExitCode.VALIDATION,
    );
  }

  const wf = loadWorkingFile(fileOpt);

  const localChanges = diffFields(wf.baseline, wf.data);
  console.log(`\nLocal edits (${wf.path} vs baseline):`);
  console.log(summarizeChanges(localChanges));
  console.log(renderFieldDiff(localChanges));

  if (parsed.options["server"]) {
    const routes = await resolveResourceRoutes(config, {
      ...parsed,
      resource: wf.resource,
    });
    const client = new WpClient(config);
    const server = await fetchForEdit(client, routes, wf.id);
    const serverChanges = diffFields(wf.baseline, server);
    console.log(`\nServer drift (baseline vs current server):`);
    console.log(summarizeChanges(serverChanges));
    console.log(renderFieldDiff(serverChanges));

    const overlap = findConflicts(localChanges, serverChanges);
    if (overlap.length > 0) {
      console.log("");
      console.log(
        `\x1b[33mConflicts on: ${overlap.join(", ")}\x1b[0m — ` +
          `both local and server edited these fields. ` +
          `Push will abort unless --force is passed.`,
      );
    }
  }
}

// -------------------- PUSH --------------------

function findConflicts(
  local: FieldChange[],
  server: FieldChange[],
): string[] {
  const serverFields = new Set(server.map((c) => c.field));
  return local.filter((c) => serverFields.has(c.field)).map((c) => c.field);
}

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const answer = prompt(`${message} [y/N]`);
  return !!answer && /^y(es)?$/i.test(answer.trim());
}

export async function handlePush(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  const fileOpt = parsed.options["file"];
  if (typeof fileOpt !== "string" || fileOpt === "") {
    throw new CliError(
      `'push' requires --file <path>.\n\n` +
        `Usage:\n` +
        `  wpklx ${parsed.resource} push --file post-42.json\n` +
        `  wpklx ${parsed.resource} push --file post-42.json --dry-run\n` +
        `  wpklx ${parsed.resource} push --file post-42.json --force`,
      ExitCode.VALIDATION,
    );
  }

  const force = parsed.options["force"] === true;
  const dryRun = parsed.options["dry-run"] === true;
  const skipConfirm =
    parsed.options["yes"] === true || parsed.options["y"] === true || force;

  const wf = loadWorkingFile(fileOpt);

  // Parser routes by parsed.resource, but the file may have been pulled for
  // a different resource. Always trust the file's metadata.
  if (wf.resource !== parsed.resource) {
    throw new CliError(
      `File ${fileOpt} was pulled for '${wf.resource}' but command was invoked for '${parsed.resource}'.\n\n` +
        `Run: wpklx ${wf.resource} push --file ${fileOpt}`,
      ExitCode.VALIDATION,
    );
  }

  const localChanges = diffFields(wf.baseline, wf.data);
  if (localChanges.length === 0) {
    logger.info(`No local changes in ${fileOpt}. Nothing to push.`);
    return;
  }

  const routes = await resolveResourceRoutes(config, parsed);
  const client = new WpClient(config);

  // Conflict detection: compare baseline to current server state.
  let conflicts: string[] = [];
  if (!force) {
    const server = await fetchForEdit(client, routes, wf.id);
    const serverChanges = diffFields(wf.baseline, server);
    conflicts = findConflicts(localChanges, serverChanges);
  }

  console.log(summarizeChanges(localChanges));
  console.log(renderFieldDiff(localChanges));

  if (conflicts.length > 0) {
    throw new CliError(
      `Conflicts detected on: ${conflicts.join(", ")}\n\n` +
        `These fields were edited locally AND on the server since the baseline was taken.\n` +
        `Options:\n` +
        `  1. Re-pull to get the latest baseline, redo your edits, and push again.\n` +
        `  2. Pass --force to overwrite the server's version.`,
      ExitCode.VALIDATION,
    );
  }

  if (dryRun) {
    logger.info(`Dry run — no changes sent.`);
    return;
  }

  if (!skipConfirm && process.stdin.isTTY) {
    const ok = await confirm(
      `Push ${localChanges.length} changed field${localChanges.length === 1 ? "" : "s"} to ${wf.resource} ${wf.id}?`,
    );
    if (!ok) {
      logger.info("Aborted.");
      return;
    }
  }

  // Build the body: only changed fields, normalised, filtered to what the
  // update route accepts.
  const allowedParams = new Set(routes.update.params.map((p) => p.name));
  const body: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const change of localChanges) {
    if (!allowedParams.has(change.field)) {
      skipped.push(change.field);
      continue;
    }
    body[change.field] = normalizeField(change.after);
  }

  if (Object.keys(body).length === 0) {
    throw new CliError(
      `None of the changed fields are accepted by the update endpoint: ${localChanges.map((c) => c.field).join(", ")}.\n\n` +
        `Accepted fields: ${[...allowedParams].sort().join(", ")}`,
      ExitCode.VALIDATION,
    );
  }

  if (skipped.length > 0) {
    logger.warn(
      `Skipped fields not accepted by update endpoint: ${skipped.join(", ")}`,
    );
  }

  const apiPath = expandPath(routes.update.path, wf.id);
  const response = await client.patch(apiPath, body);

  // After a successful push, refresh the baseline to match what the server
  // now holds — subsequent diffs/pushes stay accurate.
  const refreshed = response.data as Record<string, unknown>;
  const meta: WpklxMeta = {
    resource: wf.resource,
    id: wf.id,
    profile: config.profile_name ?? undefined,
    host: config.host,
    pulled_at: new Date().toISOString(),
  };
  writeJson(wf.baselinePath, { _wpklx: meta, ...refreshed });

  logger.info(
    `Pushed ${Object.keys(body).length} field${Object.keys(body).length === 1 ? "" : "s"} to ${wf.resource} ${wf.id}. Baseline refreshed.`,
  );
}
