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
  ConfigError,
} from "../config/profiles.ts";
import { stringify, parse } from "yaml";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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
      configRm(parsed);
      break;
    case "default":
      configDefault(parsed);
      break;
    default:
      console.log(`Unknown config subcommand: ${subcommand}`);
      console.log(`Available: ls, show, path, add, rm, default`);
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

async function configAdd(parsed: ParsedArgs): Promise<void> {
  const name = parsed.id;
  if (!name) {
    console.log("Usage: wpklx config add <profile-name>");
    process.exit(1);
  }

  // Interactive prompts using Bun's console prompt
  const host = prompt("Host (e.g., https://example.com):");
  const username = prompt("Username:");
  const applicationPassword = prompt("Application Password:");

  if (!host || !username || !applicationPassword) {
    console.log("All fields are required.");
    process.exit(1);
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

function configRm(parsed: ParsedArgs): void {
  const name = parsed.id;
  if (!name) {
    console.log("Usage: wpklx config rm <profile-name>");
    process.exit(1);
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

function configDefault(parsed: ParsedArgs): void {
  const name = parsed.id;
  if (!name) {
    console.log("Usage: wpklx config default <profile-name>");
    process.exit(1);
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
