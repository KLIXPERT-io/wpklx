import {
  loadYamlConfig,
  resolveProfile,
  ConfigError,
} from "../config/profiles.ts";
import type { YamlProfile } from "../types/config.ts";
import type { ParsedArgs, GlobalFlags } from "../types/cli.ts";

export interface ProfileResult {
  profileName: string | null;
  profile: YamlProfile | null;
  remainingArgs: string[];
}

const ACTION_SHORTCUTS: Record<string, string> = {
  ls: "list",
  show: "get",
  new: "create",
  edit: "update",
  rm: "delete",
};

const GLOBAL_FLAG_NAMES = new Set([
  "--format",
  "--fields",
  "--per-page",
  "--page",
  "--quiet",
  "--verbose",
  "--no-color",
  "--help",
  "--version",
  "--env",
]);

/**
 * Detects @name token anywhere in args, extracts the profile name,
 * and returns remaining args with the token removed.
 */
export function extractProfile(args: string[]): ProfileResult {
  const profileArg = args.find((arg) => arg.startsWith("@"));
  const remainingArgs = profileArg
    ? args.filter((arg) => arg !== profileArg)
    : args;
  const profileName = profileArg ? profileArg.slice(1) : null;

  if (profileName) {
    // @name was specified — must have YAML config
    const yamlConfig = loadYamlConfig();
    if (!yamlConfig) {
      throw new ConfigError(
        `Profile '@${profileName}' requested but no config file found. ` +
          `Create wpklx.config.yaml in your project or ~/.config/wpklx/config.yaml`,
      );
    }

    const profile = resolveProfile(yamlConfig, profileName);
    return { profileName, profile, remainingArgs };
  }

  // No @name — try to use default profile from YAML, or fall back to .env
  const yamlConfig = loadYamlConfig();
  if (yamlConfig?.default) {
    const profile = resolveProfile(yamlConfig);
    return { profileName: yamlConfig.default, profile, remainingArgs };
  }

  // No YAML config or no default — will fall back to .env
  return { profileName: null, profile: null, remainingArgs };
}

/**
 * Parses CLI arguments into a structured ParsedArgs object.
 * Expects args with @profile already extracted (use extractProfile first).
 */
export function parseArgs(args: string[]): ParsedArgs {
  const globalFlags: GlobalFlags = {};
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (GLOBAL_FLAG_NAMES.has(arg)) {
      const flagName = arg.slice(2).replace(/-/g, "_");

      // Boolean global flags
      if (
        arg === "--quiet" ||
        arg === "--verbose" ||
        arg === "--no-color" ||
        arg === "--help" ||
        arg === "--version"
      ) {
        (globalFlags as Record<string, boolean>)[flagName] = true;
        i++;
        continue;
      }

      // Value global flags
      const nextArg = args[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith("--")) {
        if (arg === "--per-page" || arg === "--page") {
          (globalFlags as Record<string, number>)[flagName] = parseInt(
            nextArg,
            10,
          );
        } else {
          (globalFlags as Record<string, string>)[flagName] = nextArg;
        }
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith("--")) {
        options[key] = nextArg;
        i += 2;
      } else {
        options[key] = true;
        i++;
      }
      continue;
    }

    positional.push(arg);
    i++;
  }

  let resource = positional[0] ?? "";
  let action = positional[1] ?? "";

  // Detect namespace prefix: "wpml:post" -> prefix="wpml", resource="post"
  let namespacePrefix: string | undefined;
  if (resource.includes(":")) {
    const colonIndex = resource.indexOf(":");
    namespacePrefix = resource.slice(0, colonIndex);
    resource = resource.slice(colonIndex + 1);
  }

  // Resolve action shortcuts
  if (ACTION_SHORTCUTS[action]) {
    action = ACTION_SHORTCUTS[action]!;
  }

  // Detect positional ID: third positional that looks numeric
  let id: string | undefined;
  const thirdPos = positional[2];
  if (thirdPos && /^\d+$/.test(thirdPos)) {
    id = thirdPos;
  }

  // Also check for --id in options
  if (options["id"] !== undefined && typeof options["id"] === "string") {
    id = options["id"];
    delete options["id"];
  }

  return { resource, action, id, namespacePrefix, options, globalFlags };
}
