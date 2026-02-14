import type { ResolvedConfig } from "../types/config.ts";
import type { ParsedArgs } from "../types/cli.ts";
import { discoverSchema } from "../api/discovery.ts";
import { loadCachedSchema, saveSchemaCache } from "../api/cache.ts";
import { mapRoutesToCommands, getResourceNames } from "../api/schema.ts";
import type { CommandMap } from "../api/schema.ts";
import { formatOutput } from "./formatters.ts";
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
