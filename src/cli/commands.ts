import type { ResolvedConfig } from "../types/config.ts";
import type { ParsedArgs } from "../types/cli.ts";
import { discoverSchema } from "../api/discovery.ts";
import { loadCachedSchema, saveSchemaCache } from "../api/cache.ts";
import { mapRoutesToCommands, getResourceNames } from "../api/schema.ts";
import type { CommandMap } from "../api/schema.ts";
import {
  loadYamlConfig,
  findConfigPath,
  resolveProfile,
} from "../config/profiles.ts";
import { formatOutput } from "./formatters.ts";
import { renderTable } from "./output.ts";
import { logger } from "../helpers/logger.ts";

/** Run the discover command — force-fetch schema from the site. */
export async function runDiscover(config: ResolvedConfig): Promise<void> {
  logger.info("Discovering API schema...");

  const schema = await discoverSchema(config);
  saveSchemaCache(config.host, schema);

  const commands = mapRoutesToCommands(schema);
  const resources = getResourceNames(commands);

  logger.info(`Discovered ${schema.routes.length} routes across ${schema.namespaces.length} namespaces.`);
  logger.info(`Resources: ${resources.join(", ")}`);
}

/** Run the routes command — show available routes. */
export async function runRoutes(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  const schema =
    loadCachedSchema(config.host, config.cache_ttl) ??
    (await discoverAndCache(config));

  const commands = mapRoutesToCommands(schema);

  // Build table data
  const rows: { Resource: string; Action: string; Method: string; Path: string }[] = [];

  for (const [resource, actions] of Object.entries(commands)) {
    for (const [action, meta] of Object.entries(actions)) {
      rows.push({
        Resource: resource,
        Action: action,
        Method: meta.method,
        Path: meta.path,
      });
    }
  }

  // Sort by resource then action
  rows.sort((a, b) => a.Resource.localeCompare(b.Resource) || a.Action.localeCompare(b.Action));

  const output = formatOutput(rows, parsed.globalFlags.format ?? config.output_format, {
    fields: parsed.globalFlags.fields,
    quiet: parsed.globalFlags.quiet,
  });
  console.log(output);
}

/** Get or discover the schema, caching the result. */
export async function getSchema(config: ResolvedConfig): Promise<CommandMap> {
  const schema =
    loadCachedSchema(config.host, config.cache_ttl) ??
    (await discoverAndCache(config));
  return mapRoutesToCommands(schema);
}

async function discoverAndCache(config: ResolvedConfig) {
  const schema = await discoverSchema(config);
  saveSchemaCache(config.host, schema);
  return schema;
}

/** Run config subcommands (ls, show, path). */
export function runConfig(parsed: ParsedArgs): void {
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
    default:
      console.log(`Unknown config subcommand: ${subcommand}`);
      console.log(`Available: ls, show, path`);
      process.exit(1);
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
