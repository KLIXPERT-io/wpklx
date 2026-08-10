import type { ResolvedConfig } from "../types/config.ts";
import type { ParsedArgs } from "../types/cli.ts";
import type { Ability, AbilityCategory } from "../types/api.ts";
import { WpClient } from "../api/client.ts";
import {
  ABILITIES_NAMESPACE,
  describeAnnotations,
  getAbility,
  getCategory,
  hasAbilitiesApi,
  listAbilities,
  listCategories,
  runAbility,
  type RunMethod,
} from "../api/abilities.ts";
import { getRawSchema } from "./commands.ts";
import { formatOutput } from "./formatters.ts";
import { CliError, ExitCode } from "../helpers/error.ts";
import { showAbilitiesHelp } from "./help.ts";

/** Resource names that route to the Abilities API command surface. */
const ABILITY_RESOURCES = new Set(["ability", "abilities"]);

/** Options consumed by the command itself — never forwarded as ability input. */
const RESERVED_OPTIONS = new Set(["input", "method", "category"]);

const ACTION_ALIASES: Record<string, string> = {
  "": "list",
  ls: "list",
  list: "list",
  show: "get",
  get: "get",
  exec: "run",
  call: "run",
  run: "run",
  categories: "categories",
  cats: "categories",
  category: "category",
  cat: "category",
};

export function isAbilitiesResource(resource: string): boolean {
  return ABILITY_RESOURCES.has(resource);
}

/**
 * Execute an `wpklx ability ...` command.
 *
 * A 404 is ambiguous here — it could mean the ability doesn't exist, or that
 * the site predates WordPress 6.9 and has no Abilities API at all. Check the
 * discovered schema on failure so the second case gets a useful message.
 */
export async function runAbilities(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  try {
    await dispatch(config, parsed);
  } catch (error) {
    if (error instanceof CliError && error.exitCode === ExitCode.NOT_FOUND) {
      const schema = await getRawSchema(config).catch(() => null);
      if (schema && !hasAbilitiesApi(schema)) {
        throw new CliError(
          `This site does not expose the Abilities API (${ABILITIES_NAMESPACE}).\n\n` +
            `The Abilities API ships with WordPress 6.9. To fix:\n` +
            `  1. Update the site to WordPress 6.9 or later, or install the\n` +
            `     Abilities API plugin (wordpress.org/plugins/abilities-api)\n` +
            `  2. Refresh the cached schema: wpklx discover\n` +
            `  3. Check what the site does expose: wpklx routes`,
          ExitCode.NOT_FOUND,
        );
      }
    }
    throw error;
  }
}

async function dispatch(
  config: ResolvedConfig,
  parsed: ParsedArgs,
): Promise<void> {
  const action = Object.hasOwn(ACTION_ALIASES, parsed.action)
    ? ACTION_ALIASES[parsed.action]
    : undefined;
  if (!action) {
    throw new CliError(
      `Unknown action '${parsed.action}' for 'ability'.\n\n` +
        `Available actions: list, get, run, categories, category\n` +
        `Action shortcuts: ls→list, show→get, exec/call→run\n\n` +
        `For full details: wpklx ability help`,
      ExitCode.NOT_FOUND,
    );
  }

  const client = new WpClient(config);
  const format = parsed.globalFlags.format ?? config.output_format;
  const quiet = parsed.globalFlags.quiet === true;

  switch (action) {
    case "list": {
      const abilities = await listAbilities(client, {
        perPage: parsed.globalFlags.per_page ?? config.per_page,
        page: parsed.globalFlags.page,
        category: readStringOption(parsed, "category"),
      });

      if (quiet) {
        console.log(abilities.map((a) => a.name).join("\n"));
        return;
      }
      if (format === "table" && !parsed.globalFlags.fields) {
        console.log(formatOutput(abilities.map(toAbilityRow), format));
        return;
      }
      console.log(
        formatOutput(abilities, format, { fields: parsed.globalFlags.fields }),
      );
      return;
    }

    case "get": {
      const name = requireTarget(parsed, "get", "<namespace>/<ability>");
      const ability = await getAbility(client, name);

      if (quiet) {
        console.log(ability.name);
        return;
      }
      // An ability is mostly nested JSON Schema — table output would hide it.
      console.log(
        formatOutput(ability, format === "table" ? "yaml" : format, {
          fields: parsed.globalFlags.fields,
        }),
      );
      return;
    }

    case "run": {
      const name = requireTarget(parsed, "run", "<namespace>/<ability>");
      const input = buildInput(parsed);
      const method = readMethodOption(parsed);
      const result = await runAbility(client, name, input, method);

      if (quiet) {
        console.log(
          typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data),
        );
        return;
      }
      // Ability output follows an arbitrary output_schema, so default to JSON
      // rather than the table format used for CRUD resources.
      const runFormat = parsed.globalFlags.format ?? "json";
      console.log(
        formatOutput(result.data, runFormat, {
          fields: parsed.globalFlags.fields,
        }),
      );
      return;
    }

    case "categories": {
      const categories = await listCategories(client, {
        perPage: parsed.globalFlags.per_page ?? config.per_page,
        page: parsed.globalFlags.page,
      });

      if (quiet) {
        console.log(categories.map((c) => c.slug).join("\n"));
        return;
      }
      if (format === "table" && !parsed.globalFlags.fields) {
        console.log(formatOutput(categories.map(toCategoryRow), format));
        return;
      }
      console.log(
        formatOutput(categories, format, { fields: parsed.globalFlags.fields }),
      );
      return;
    }

    case "category": {
      const slug = requireTarget(parsed, "category", "<slug>");
      const category = await getCategory(client, slug);

      if (quiet) {
        console.log(category.slug);
        return;
      }
      console.log(
        formatOutput(category, format === "table" ? "yaml" : format, {
          fields: parsed.globalFlags.fields,
        }),
      );
      return;
    }

    default:
      showAbilitiesHelp();
  }
}

function toAbilityRow(ability: Ability): Record<string, unknown> {
  return {
    name: ability.name,
    label: ability.label ?? "",
    category: ability.category ?? "",
    annotations: describeAnnotations(ability),
  };
}

function toCategoryRow(category: AbilityCategory): Record<string, unknown> {
  return {
    slug: category.slug,
    label: category.label ?? "",
    description: category.description ?? "",
  };
}

/**
 * Reads the positional target of the command — the ability name or category slug.
 * Also accepts a namespace and ability passed as two separate arguments.
 */
function requireTarget(
  parsed: ParsedArgs,
  action: string,
  placeholder: string,
): string {
  const first = parsed.positional[2];
  if (!first) {
    throw new CliError(
      `'ability ${action}' requires ${placeholder}.\n\n` +
        `Usage:\n` +
        `  wpklx ability ${action} ${placeholder}\n\n` +
        `Run 'wpklx ability list' to see what this site exposes.`,
      ExitCode.VALIDATION,
    );
  }

  const second = parsed.positional[3];
  if (second && !first.includes("/")) {
    return `${first}/${second}`;
  }
  return first;
}

function readStringOption(
  parsed: ParsedArgs,
  key: string,
): string | undefined {
  const value = parsed.options[key];
  return typeof value === "string" ? value : undefined;
}

function readMethodOption(parsed: ParsedArgs): RunMethod | undefined {
  const raw = readStringOption(parsed, "method");
  if (!raw) return undefined;

  const method = raw.toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "DELETE") {
    throw new CliError(
      `Invalid --method '${raw}'. The /run endpoint accepts GET, POST or DELETE.\n\n` +
        `Omit --method to let wpklx pick it from the ability's annotations\n` +
        `(readonly → GET, destructive → DELETE, otherwise POST).`,
      ExitCode.VALIDATION,
    );
  }
  return method;
}

/**
 * Builds the ability input: either the raw JSON from --input, or an object
 * assembled from the remaining --key value flags. Returns undefined when the
 * ability takes no input.
 */
function buildInput(parsed: ParsedArgs): unknown {
  const raw = parsed.options["input"];

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new CliError(
        `--input must be valid JSON. Received:\n  ${raw}\n\n` +
          `Examples:\n` +
          `  wpklx ability run my-plugin/get-user --input '{"user_id":1}'\n` +
          `  wpklx ability run my-plugin/get-user --user_id 1\n` +
          `  cat input.json | wpklx ability run my-plugin/get-user --input -`,
        ExitCode.VALIDATION,
      );
    }
  }

  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.options)) {
    if (RESERVED_OPTIONS.has(key)) continue;
    input[key] = coerceValue(value);
  }

  return Object.keys(input).length > 0 ? input : undefined;
}

/** Coerces a CLI string into the JSON type an input schema is likely to expect. */
function coerceValue(value: string | boolean): unknown {
  if (typeof value === "boolean") return value;

  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
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
