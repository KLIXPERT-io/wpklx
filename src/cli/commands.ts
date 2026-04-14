import type { ResolvedConfig } from "../types/config.ts";
import type { ParsedArgs } from "../types/cli.ts";
import { discoverSchema } from "../api/discovery.ts";
import { WpClient } from "../api/client.ts";
import { loadCachedSchema, saveSchemaCache } from "../api/cache.ts";
import {
  mapRoutesToCommands,
  getResourceNames,
  resolveNamespacePrefix,
} from "../api/schema.ts";
import type { CommandMap } from "../api/schema.ts";
import type { DiscoveredSchema } from "../types/api.ts";
import {
  loadYamlConfig,
  findConfigPath,
  resolveProfile,
  ConfigError,
} from "../config/profiles.ts";
import { stringify, parse } from "yaml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { formatOutput } from "./formatters.ts";
import { renderTable } from "./output.ts";
import { suggestSimilar } from "./help.ts";
import { logger } from "../helpers/logger.ts";
import { CliError, ExitCode } from "../helpers/error.ts";
import { safeExit } from "../helpers/exit.ts";
import { serializeToBlocks } from "../helpers/wp-serialize.ts";
import { markdownToHtml } from "../vendor/mmd.ts";
import {
  saveRevision,
  listRevisions,
  loadRevision,
} from "../helpers/revisions.ts";

/** Run the discover command — force-fetch schema from the site. */
export async function runDiscover(config: ResolvedConfig): Promise<void> {
  logger.info("Discovering API schema...");

  const schema = await discoverSchema(config);
  saveSchemaCache(config.host, schema);

  const commands = mapRoutesToCommands(schema);
  const resources = getResourceNames(commands);

  logger.info(
    `Discovered ${schema.routes.length} routes across ${schema.namespaces.length} namespaces.`,
  );
  logger.info(`Resources: ${resources.join(", ")}`);
}

/** Run the routes command — show available routes. */
export async function runRoutes(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  const schema = await getRawSchema(config);
  const commands = mapRoutesToCommands(schema);

  // Build table data with Namespace column
  const rows: {
    Resource: string;
    Action: string;
    Method: string;
    Namespace: string;
    Path: string;
  }[] = [];

  for (const [resource, actions] of Object.entries(commands)) {
    for (const [action, meta] of Object.entries(actions)) {
      // Extract namespace from path: "/wp/v2/posts" -> "wp/v2"
      const pathSegments = meta.path.replace(/^\//, "").split("/");
      const ns =
        pathSegments.length >= 2 ? `${pathSegments[0]}/${pathSegments[1]}` : "";
      rows.push({
        Resource: resource,
        Action: action,
        Method: meta.method,
        Namespace: ns,
        Path: meta.path,
      });
    }
  }

  // Sort by resource then action
  rows.sort(
    (a, b) =>
      a.Resource.localeCompare(b.Resource) || a.Action.localeCompare(b.Action),
  );

  const output = formatOutput(
    rows,
    parsed.globalFlags.format ?? config.output_format,
    {
      fields: parsed.globalFlags.fields,
      quiet: parsed.globalFlags.quiet,
    },
  );
  console.log(output);
}

/** Get or discover the schema, caching the result. */
export async function getSchema(config: ResolvedConfig): Promise<CommandMap> {
  const schema = await getRawSchema(config);
  return mapRoutesToCommands(schema);
}

/** Get the raw discovered schema (cached or fresh). */
async function getRawSchema(config: ResolvedConfig): Promise<DiscoveredSchema> {
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

/** Try to parse a string value as JSON. Returns parsed object/array if valid, original value otherwise. */
function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

/** Strip the first <h1> element from HTML. */
function stripFirstH1(html: string): string {
  return html.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/, "");
}

/**
 * Apply --serialize flag: convert content HTML to WordPress block HTML.
 * Throws if --serialize is set but no content is available.
 */
async function applySerializeFlag(
  options: Record<string, string | boolean>,
  parsed: ParsedArgs,
): Promise<void> {
  if (!parsed.globalFlags.serialize) return;

  // Silently ignore on read-only actions
  const action = parsed.action;
  if (action !== "create" && action !== "update") return;

  const content = options["content"];
  if (content === undefined || content === true || content === "") {
    throw new CliError(
      `--serialize requires --content to be provided with HTML content.\n\n` +
        `Usage:\n` +
        `  wpklx ${parsed.resource} ${parsed.action} --content "<p>Hello</p>" --serialize\n` +
        `  wpklx ${parsed.resource} ${parsed.action} --content "$(cat page.html)" --serialize`,
      ExitCode.VALIDATION,
    );
  }

  let html = content as string;
  if (parsed.globalFlags.no_h1) {
    html = stripFirstH1(html);
  }

  options["content"] = await serializeToBlocks(html);
}

/**
 * Apply --markdown flag: convert content Markdown to HTML, then to WordPress block HTML.
 * Mutually exclusive with --serialize. Throws if no content is available.
 */
async function applyMarkdownFlag(
  options: Record<string, string | boolean>,
  parsed: ParsedArgs,
): Promise<void> {
  if (!parsed.globalFlags.markdown) return;

  // Mutual exclusivity check
  if (parsed.globalFlags.serialize) {
    throw new CliError(
      `--serialize and --markdown are mutually exclusive. Use one or the other.\n\n` +
        `  --serialize: converts raw HTML to WordPress block HTML\n` +
        `  --markdown: converts Markdown to WordPress block HTML`,
      ExitCode.VALIDATION,
    );
  }

  // Silently ignore on read-only actions
  const action = parsed.action;
  if (action !== "create" && action !== "update") return;

  const content = options["content"];
  if (content === undefined || content === true || content === "") {
    throw new CliError(
      `--markdown requires --content to be provided with Markdown content.\n\n` +
        `Usage:\n` +
        `  wpklx ${parsed.resource} ${parsed.action} --content "## Hello" --markdown\n` +
        `  wpklx ${parsed.resource} ${parsed.action} --content "$(cat article.md)" --markdown`,
      ExitCode.VALIDATION,
    );
  }

  let html = markdownToHtml(content as string);
  if (parsed.globalFlags.no_h1) {
    html = stripFirstH1(html);
  }
  options["content"] = await serializeToBlocks(html);
}

/** Execute a dynamic resource command (CRUD). */
export async function executeCommand(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  // Special case: local revision commands
  if (parsed.action === "revisions") {
    await handleRevisionsList(config, parsed);
    return;
  }
  if (parsed.action === "restore") {
    await handleRestore(config, parsed);
    return;
  }

  // Special case: media upload
  if (parsed.resource === "media" && parsed.action === "upload") {
    await handleMediaUpload(config, parsed);
    return;
  }

  const schema = await getRawSchema(config);

  // Resolve namespace prefix if specified (e.g., "wpml:post")
  let namespaceFilter: string | undefined;
  if (parsed.namespacePrefix) {
    const resolved = resolveNamespacePrefix(
      schema.namespaces,
      parsed.namespacePrefix,
    );
    if (!resolved) {
      console.error(`Unknown namespace: ${parsed.namespacePrefix}`);
      suggestSimilar(parsed.namespacePrefix, schema.namespaces);
      await safeExit(ExitCode.NOT_FOUND);
    }
    namespaceFilter = resolved;
  }

  const commands = mapRoutesToCommands(schema, namespaceFilter);
  const resourceCommands = commands[parsed.resource];

  if (!resourceCommands) {
    console.error(`Unknown resource: ${parsed.resource}`);
    suggestSimilar(parsed.resource, Object.keys(commands));
    await safeExit(ExitCode.NOT_FOUND);
  }

  const actionMeta = resourceCommands[parsed.action];
  if (!actionMeta) {
    const available = Object.keys(resourceCommands).join(", ");
    throw new CliError(
      `Unknown action '${parsed.action}' for resource '${parsed.resource}'.\n\n` +
        `Available actions: ${available}\n\n` +
        `Action shortcuts: ls→list, show→get, new→create, edit→update, rm→delete\n` +
        `For full details: wpklx ${parsed.resource} help`,
      ExitCode.NOT_FOUND,
    );
  }

  const client = new WpClient(config);

  // Build the actual API path, replacing path params
  let apiPath = actionMeta.path;

  // Replace regex path params like (?P<id>[\d]+) with actual values
  if (parsed.id) {
    apiPath = apiPath.replace(/\/\(\?P<id>[^)]+\)/, `/${parsed.id}`);
  }

  // Remove remaining regex path params (shouldn't happen but safety)
  apiPath = apiPath.replace(/\/\(\?P<[^>]+>[^)]+\)/g, "");

  // Build query params / body from parsed options
  const options = { ...parsed.options } as Record<string, string | boolean>;

  switch (parsed.action) {
    case "list": {
      const params: Record<string, string> = {};
      // Add pagination
      if (parsed.globalFlags.per_page) {
        params["per_page"] = String(parsed.globalFlags.per_page);
      } else {
        params["per_page"] = String(config.per_page);
      }
      if (parsed.globalFlags.page) {
        params["page"] = String(parsed.globalFlags.page);
      }
      // Add other options as query params
      for (const [key, value] of Object.entries(options)) {
        params[key] = String(value);
      }

      const response = await client.get(apiPath, params);
      const output = formatOutput(
        response.data,
        parsed.globalFlags.format ?? config.output_format,
        {
          fields: parsed.globalFlags.fields,
          quiet: parsed.globalFlags.quiet,
        },
      );
      console.log(output);
      break;
    }

    case "get": {
      if (!parsed.id) {
        throw new CliError(
          `'get' requires an ID. Pass the ID as a positional argument or use --id.\n\n` +
            `Usage:\n` +
            `  wpklx ${parsed.resource} get <id>\n` +
            `  wpklx ${parsed.resource} show <id> --fields all`,
          ExitCode.VALIDATION,
        );
      }
      const getParams: Record<string, string> = {};
      for (const [key, value] of Object.entries(options)) {
        getParams[key] = String(value);
      }
      const response = await client.get(apiPath, getParams);
      const output = formatOutput(
        response.data,
        parsed.globalFlags.format ?? config.output_format,
        {
          fields: parsed.globalFlags.fields,
          quiet: parsed.globalFlags.quiet,
        },
      );
      console.log(output);
      break;
    }

    case "create": {
      await applySerializeFlag(options, parsed);
      await applyMarkdownFlag(options, parsed);
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(options)) {
        body[key] = tryParseJson(value);
      }
      const response = await client.post(apiPath, body);
      const output = formatOutput(
        response.data,
        parsed.globalFlags.format ?? config.output_format,
        {
          fields: parsed.globalFlags.fields,
          quiet: parsed.globalFlags.quiet,
        },
      );
      console.log(output);
      break;
    }

    case "update": {
      if (!parsed.id) {
        throw new CliError(
          `'update' requires an ID. Pass the ID as a positional argument or use --id.\n\n` +
            `Usage:\n` +
            `  wpklx ${parsed.resource} update <id> --field value\n` +
            `  wpklx ${parsed.resource} edit <id> --title "New Title"`,
          ExitCode.VALIDATION,
        );
      }
      if (parsed.globalFlags.revision) {
        const snapshot = await client.get(apiPath, { context: "edit" });
        saveRevision(
          config.profile_name,
          config.host,
          parsed.resource,
          parsed.id,
          snapshot.data,
        );
      }
      await applySerializeFlag(options, parsed);
      await applyMarkdownFlag(options, parsed);
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(options)) {
        body[key] = tryParseJson(value);
      }
      const response = await client.patch(apiPath, body);
      const output = formatOutput(
        response.data,
        parsed.globalFlags.format ?? config.output_format,
        {
          fields: parsed.globalFlags.fields,
          quiet: parsed.globalFlags.quiet,
        },
      );
      console.log(output);
      break;
    }

    case "delete": {
      if (!parsed.id) {
        throw new CliError(
          `'delete' requires an ID. Pass the ID as a positional argument or use --id.\n\n` +
            `Usage:\n` +
            `  wpklx ${parsed.resource} delete <id>\n` +
            `  wpklx ${parsed.resource} rm <id> --force true`,
          ExitCode.VALIDATION,
        );
      }
      if (parsed.globalFlags.revision) {
        const snapshot = await client.get(apiPath, { context: "edit" });
        saveRevision(
          config.profile_name,
          config.host,
          parsed.resource,
          parsed.id,
          snapshot.data,
        );
      }
      const params: Record<string, string> = {};
      if (options["force"]) {
        params["force"] = "true";
        delete options["force"];
      }
      const response = await client.delete(apiPath, params);

      if (parsed.globalFlags.quiet) {
        // Quiet mode on delete: no output, just exit code
      } else {
        const output = formatOutput(
          response.data,
          parsed.globalFlags.format ?? config.output_format,
          { fields: parsed.globalFlags.fields },
        );
        console.log(output);
      }
      break;
    }

    default:
      throw new CliError(
        `Unknown action '${parsed.action}' for resource '${parsed.resource}'.\n\n` +
          `Available actions: list, get, create, update, delete\n` +
          `Action shortcuts: ls→list, show→get, new→create, edit→update, rm→delete\n\n` +
          `For full details: wpklx ${parsed.resource} help`,
        ExitCode.VALIDATION,
      );
  }
}

/** List local revisions for a resource ID. */
async function handleRevisionsList(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  if (!parsed.id) {
    throw new CliError(
      `'revisions' requires an ID. Usage: wpklx ${parsed.resource} revisions <id>`,
      ExitCode.VALIDATION,
    );
  }

  const revisions = listRevisions(
    config.profile_name,
    config.host,
    parsed.resource,
    parsed.id,
  );

  if (revisions.length === 0) {
    console.log(`No revisions found for ${parsed.resource} ${parsed.id}.`);
    return;
  }

  const rows = revisions.map((r) => ({
    Rev: r.index,
    Timestamp: r.timestamp,
  }));

  const output = formatOutput(
    rows,
    parsed.globalFlags.format ?? config.output_format,
    {
      fields: parsed.globalFlags.fields,
      quiet: parsed.globalFlags.quiet,
    },
  );
  console.log(output);
}

/** Restore a local revision snapshot by pushing it back via the API. */
async function handleRestore(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  if (!parsed.id) {
    throw new CliError(
      `'restore' requires an ID. Usage: wpklx ${parsed.resource} restore <id> [--rev N]`,
      ExitCode.VALIDATION,
    );
  }

  const rev = parsed.globalFlags.rev ?? 1;
  const data = loadRevision(
    config.profile_name,
    config.host,
    parsed.resource,
    parsed.id,
    rev,
  );

  if (!data) {
    const revisions = listRevisions(
      config.profile_name,
      config.host,
      parsed.resource,
      parsed.id,
    );
    if (revisions.length === 0) {
      throw new CliError(
        `No revisions found for ${parsed.resource} ${parsed.id}.`,
        ExitCode.NOT_FOUND,
      );
    }
    throw new CliError(
      `Revision ${rev} not found. Available: 1-${revisions.length}.`,
      ExitCode.NOT_FOUND,
    );
  }

  // Discover schema to find the update route for this resource
  const schema = await getRawSchema(config);
  let namespaceFilter: string | undefined;
  if (parsed.namespacePrefix) {
    namespaceFilter =
      resolveNamespacePrefix(schema.namespaces, parsed.namespacePrefix) ??
      undefined;
  }
  const commands = mapRoutesToCommands(schema, namespaceFilter);
  const resourceCommands = commands[parsed.resource];

  if (!resourceCommands?.["update"]) {
    throw new CliError(
      `Resource '${parsed.resource}' does not support update — cannot restore.`,
      ExitCode.VALIDATION,
    );
  }

  const updateMeta = resourceCommands["update"];
  let apiPath = updateMeta.path.replace(/\/\(\?P<id>[^)]+\)/, `/${parsed.id}`);
  apiPath = apiPath.replace(/\/\(\?P<[^>]+>[^)]+\)/g, "");

  // Filter the snapshot to only include fields accepted by the update endpoint
  const allowedParams = new Set(updateMeta.params.map((p) => p.name));
  const body: Record<string, unknown> = {};
  const snapshot = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(snapshot)) {
    if (allowedParams.has(key)) {
      // For rendered fields (e.g., title.rendered), extract the raw value
      if (
        value &&
        typeof value === "object" &&
        "raw" in (value as Record<string, unknown>)
      ) {
        body[key] = (value as Record<string, unknown>)["raw"];
      } else if (
        value &&
        typeof value === "object" &&
        "rendered" in (value as Record<string, unknown>)
      ) {
        body[key] = (value as Record<string, unknown>)["rendered"];
      } else {
        body[key] = value;
      }
    }
  }

  const client = new WpClient(config);
  const response = await client.patch(apiPath, body);

  const output = formatOutput(
    response.data,
    parsed.globalFlags.format ?? config.output_format,
    {
      fields: parsed.globalFlags.fields,
      quiet: parsed.globalFlags.quiet,
    },
  );
  console.log(output);
}

/** Infer MIME type from a filename extension */
function inferMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };
  return ext
    ? (mimeMap[ext] ?? "application/octet-stream")
    : "application/octet-stream";
}

/** Handle media upload command. */
async function handleMediaUpload(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  const fileOpt = parsed.options["file"];

  const fields: Record<string, string> = {};
  if (parsed.options["title"] && typeof parsed.options["title"] === "string") {
    fields["title"] = parsed.options["title"];
  }
  if (
    parsed.options["alt-text"] &&
    typeof parsed.options["alt-text"] === "string"
  ) {
    fields["alt_text"] = parsed.options["alt-text"];
  }

  const client = new WpClient(config);

  if (fileOpt === "__stdin__" && parsed.stdinData) {
    // Binary stdin upload
    const filename =
      (parsed.options["title"] as string) ??
      (parsed.options["filename"] as string) ??
      "upload";
    const mimeType =
      (parsed.options["mime-type"] as string) ?? inferMimeType(filename);
    const blob = new Blob([parsed.stdinData], { type: mimeType });

    // Ensure title is set for FormData filename
    if (!fields["title"]) {
      fields["title"] = filename;
    }

    const response = await client.upload("/wp/v2/media", blob, fields);
    const output = formatOutput(
      response.data,
      parsed.globalFlags.format ?? config.output_format,
      {
        fields: parsed.globalFlags.fields,
        quiet: parsed.globalFlags.quiet,
      },
    );
    console.log(output);
    return;
  }

  if (!fileOpt || typeof fileOpt !== "string") {
    throw new CliError(
      `Media upload requires --file <path>.\n\n` +
        `Usage:\n` +
        `  wpklx media upload --file ./photo.jpg\n` +
        `  wpklx media upload --file ./hero.jpg --title "Hero" --alt-text "Hero image"\n` +
        `  cat photo.jpg | wpklx media upload --file - --title "Piped Photo"\n\n` +
        `Supported formats: jpg, png, gif, webp, svg, pdf, mp4, mp3, wav`,
      ExitCode.VALIDATION,
    );
  }

  const response = await client.upload("/wp/v2/media", fileOpt, fields);

  const output = formatOutput(
    response.data,
    parsed.globalFlags.format ?? config.output_format,
    {
      fields: parsed.globalFlags.fields,
      quiet: parsed.globalFlags.quiet,
    },
  );
  console.log(output);
}

/** Run config subcommands. */
export async function runConfig(parsed: ParsedArgs): Promise<void> {
  const subcommand = parsed.action;

  switch (subcommand) {
    case "ls":
    case "list":
      configList(parsed);
      break;
    case "show":
    case "get":
      configShow(parsed);
      break;
    case "path":
      configPath();
      break;
    case "add":
    case "new":
    case "create":
      await configAdd(parsed);
      break;
    case "rm":
    case "delete":
      await configRm(parsed);
      break;
    case "default":
      await configDefault(parsed);
      break;
    default:
      console.log(`Unknown config subcommand: ${subcommand}\n`);
      console.log(`Available subcommands:`);
      console.log(`  ls       List all configured profiles`);
      console.log(`  show     Show resolved settings for a profile`);
      console.log(`  path     Print the path to the config file in use`);
      console.log(`  add      Add a new profile interactively`);
      console.log(`  rm       Remove a profile`);
      console.log(`  default  Set the default profile`);
      await safeExit(1);
  }
}

function configList(parsed: ParsedArgs): void {
  const yamlConfig = loadYamlConfig();
  if (!yamlConfig) {
    console.log("No config file found.");
    return;
  }

  const defaultProfile = yamlConfig.default;
  const profileNames = Object.keys(yamlConfig.profiles);

  // Check for active @profile from remaining positional args
  const activeProfile = parsed.id; // could be used to mark active

  const headers = ["Profile", "Status"];
  const rows = profileNames.map((name) => {
    const markers: string[] = [];
    if (name === defaultProfile) markers.push("default");
    if (name === activeProfile) markers.push("active");
    return [name, markers.join(", ")];
  });

  console.log(renderTable(headers, rows));
}

function configShow(parsed: ParsedArgs): void {
  const yamlConfig = loadYamlConfig();
  if (!yamlConfig) {
    console.log("No config file found.");
    return;
  }

  // Get profile name from positional arg or use default
  const profileName = parsed.id ?? yamlConfig.default;
  if (!profileName) {
    console.log("No profile specified and no default set.");
    return;
  }

  const profile = resolveProfile(yamlConfig, profileName);

  const headers = ["Setting", "Value"];
  const rows = Object.entries(profile).map(([key, value]) => {
    const displayValue =
      key === "application_password" ? "****" : String(value ?? "");
    return [key, displayValue];
  });

  console.log(`Profile: ${profileName}`);
  console.log(renderTable(headers, rows));
}

function configPath(): void {
  const path = findConfigPath();
  if (path) {
    console.log(path);
  } else {
    console.log("No config file found.");
    console.log(
      "Create wpklx.config.yaml in your project or ~/.config/wpklx/config.yaml",
    );
  }
}

async function configAdd(parsed: ParsedArgs): Promise<void> {
  const name = parsed.id;
  if (!name) {
    console.log("Usage: wpklx config add <profile-name>");
    await safeExit(1);
  }

  // Interactive prompts using Bun's console prompt
  const host = prompt("Host (e.g., https://example.com):");
  const username = prompt("Username:");
  const applicationPassword = prompt("Application Password:");

  if (!host || !username || !applicationPassword) {
    console.log("All fields are required.");
    await safeExit(1);
  }

  // Optional settings
  const apiPrefix = prompt("API prefix [/wp-json]:");
  const perPage = prompt("Per page [20]:");

  const profile: Record<string, unknown> = {
    host,
    username,
    application_password: applicationPassword,
  };

  if (apiPrefix) profile["api_prefix"] = apiPrefix;
  if (perPage) profile["per_page"] = parseInt(perPage, 10);

  // Load or create config
  let configPath = findConfigPath();
  let configData: Record<string, unknown>;

  if (configPath) {
    const content = readFileSync(configPath, "utf-8");
    configData = (parse(content) as Record<string, unknown>) ?? {};
  } else {
    // Create in ~/.config/wpklx/
    const configDir = join(homedir(), ".config", "wpklx");
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    configPath = join(configDir, "config.yaml");
    configData = {};
  }

  if (!configData["profiles"]) {
    configData["profiles"] = {};
  }

  const profiles = configData["profiles"] as Record<string, unknown>;
  profiles[name] = profile;

  // Set as default if it's the first profile
  if (!configData["default"]) {
    configData["default"] = name;
  }

  writeFileSync(configPath, stringify(configData));
  console.log(`Profile '${name}' added to ${configPath}`);
}

async function configRm(parsed: ParsedArgs): Promise<void> {
  const name = parsed.id;
  if (!name) {
    console.log("Usage: wpklx config rm <profile-name>");
    await safeExit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    throw new ConfigError("No config file found.");
  }

  const content = readFileSync(configPath, "utf-8");
  const configData = (parse(content) as Record<string, unknown>) ?? {};
  const profiles = (configData["profiles"] as Record<string, unknown>) ?? {};

  if (!(name in profiles)) {
    throw new ConfigError(`Profile '${name}' not found.`);
  }

  // Refuse to remove default unless another exists
  if (configData["default"] === name && Object.keys(profiles).length > 1) {
    throw new ConfigError(
      `Cannot remove default profile '${name}'. Set another profile as default first with: wpklx config default <other-profile>`,
    );
  }

  delete profiles[name];

  // If removed the default and it was the only one, clear default
  if (configData["default"] === name) {
    delete configData["default"];
  }

  writeFileSync(configPath, stringify(configData));
  console.log(`Profile '${name}' removed.`);
}

async function configDefault(parsed: ParsedArgs): Promise<void> {
  const name = parsed.id;
  if (!name) {
    console.log("Usage: wpklx config default <profile-name>");
    await safeExit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    throw new ConfigError("No config file found.");
  }

  const content = readFileSync(configPath, "utf-8");
  const configData = (parse(content) as Record<string, unknown>) ?? {};
  const profiles = (configData["profiles"] as Record<string, unknown>) ?? {};

  if (!(name in profiles)) {
    throw new ConfigError(`Profile '${name}' not found.`);
  }

  configData["default"] = name;

  writeFileSync(configPath, stringify(configData));
  console.log(`Default profile set to '${name}'.`);
}
