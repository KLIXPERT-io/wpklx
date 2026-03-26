import {
  loadYamlConfig,
  resolveProfile,
  ConfigError,
} from "../config/profiles.ts";
import type { YamlProfile } from "../types/config.ts";
import type { ParsedArgs, GlobalFlags } from "../types/cli.ts";
import { CliError, ExitCode } from "../helpers/error.ts";

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
  "--serialize",
  "--markdown",
  "--no-h1",
  "--no-auto-update",
  "--revision",
  "--rev",
  "--profile",
  "-p",
]);

/**
 * Extracts --profile / -p flag value from args, returning the value and remaining args.
 * Returns null if neither flag is present.
 */
function extractProfileFlag(args: string[]): { flagProfileName: string | null; remainingArgs: string[] } {
  const remainingArgs: string[] = [];
  let flagProfileName: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--profile" || arg === "-p") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        // Will be caught later with a helpful error listing available profiles
        const yamlConfig = loadYamlConfig();
        const available = yamlConfig
          ? Object.keys(yamlConfig.profiles).join(", ")
          : "none (no config file found)";
        throw new CliError(
          `--profile requires a profile name.\n\nAvailable profiles: ${available}\n\nTo add a profile, run: wpklx login`,
          ExitCode.VALIDATION,
        );
      }
      flagProfileName = nextArg;
      i++; // skip the value
      continue;
    }

    // Handle --profile=value
    if (arg.startsWith("--profile=")) {
      flagProfileName = arg.slice("--profile=".length);
      if (!flagProfileName) {
        const yamlConfig = loadYamlConfig();
        const available = yamlConfig
          ? Object.keys(yamlConfig.profiles).join(", ")
          : "none (no config file found)";
        throw new CliError(
          `--profile requires a profile name.\n\nAvailable profiles: ${available}\n\nTo add a profile, run: wpklx login`,
          ExitCode.VALIDATION,
        );
      }
      continue;
    }

    remainingArgs.push(arg);
  }

  return { flagProfileName, remainingArgs };
}

/**
 * Detects @name token and/or --profile/-p flag anywhere in args, extracts the profile name,
 * and returns remaining args with the token removed.
 *
 * If both @name and --profile are present, throws an error.
 */
export function extractProfile(args: string[]): ProfileResult {
  // First extract --profile / -p flag
  const { flagProfileName, remainingArgs: argsWithoutFlag } = extractProfileFlag(args);

  // Then extract @name token
  const atArg = argsWithoutFlag.find((arg) => arg.startsWith("@"));
  const remainingArgs = atArg
    ? argsWithoutFlag.filter((arg) => arg !== atArg)
    : argsWithoutFlag;
  const atProfileName = atArg ? atArg.slice(1) : null;

  // Conflict detection: both @name and --profile specified
  if (atProfileName && flagProfileName) {
    throw new CliError(
      `Profile specified twice: @${atProfileName} and --profile ${flagProfileName}. Use one or the other.`,
      ExitCode.VALIDATION,
    );
  }

  const profileName = flagProfileName ?? atProfileName;

  if (profileName) {
    const yamlConfig = loadYamlConfig();
    if (!yamlConfig) {
      throw new ConfigError(
        `Profile '${profileName}' requested but no config file found.\n\n` +
          `To fix:\n` +
          `  1. Run wpklx login to create a profile interactively\n` +
          `  2. Or create wpklx.config.yaml in your project directory\n` +
          `  3. Or create ~/.config/wpklx/config.yaml for global use`,
      );
    }

    const profile = resolveProfile(yamlConfig, profileName);
    return { profileName, profile, remainingArgs };
  }

  // No profile specified — try to use default profile from YAML, or fall back to .env
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
  // Normalize --key=value into --key value
  const normalizedArgs: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const eqIndex = arg.indexOf("=");
      normalizedArgs.push(arg.slice(0, eqIndex));
      normalizedArgs.push(arg.slice(eqIndex + 1));
    } else {
      normalizedArgs.push(arg);
    }
  }

  const globalFlags: GlobalFlags = {};
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  let stdinFlag: string | undefined;

  let i = 0;
  while (i < normalizedArgs.length) {
    const arg = normalizedArgs[i]!;

    if (GLOBAL_FLAG_NAMES.has(arg)) {
      // Normalize -p to --profile for consistent handling
      const normalizedFlag = arg === "-p" ? "--profile" : arg;
      const flagName = normalizedFlag.slice(2).replace(/-/g, "_");

      // Boolean global flags
      if (
        normalizedFlag === "--quiet" ||
        normalizedFlag === "--verbose" ||
        normalizedFlag === "--no-color" ||
        normalizedFlag === "--help" ||
        normalizedFlag === "--version" ||
        normalizedFlag === "--serialize" ||
        normalizedFlag === "--markdown" ||
        normalizedFlag === "--no-h1" ||
        normalizedFlag === "--no-auto-update" ||
        normalizedFlag === "--revision"
      ) {
        (globalFlags as Record<string, boolean>)[flagName] = true;
        i++;
        continue;
      }

      // Value global flags
      const nextArg = normalizedArgs[i + 1];
      if (nextArg !== undefined && !nextArg.startsWith("--")) {
        if (normalizedFlag === "--per-page" || normalizedFlag === "--page" || normalizedFlag === "--rev") {
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
      const nextArg = normalizedArgs[i + 1];
      // Detect --flag - (stdin sentinel)
      if (nextArg === "-") {
        if (stdinFlag) {
          throw new CliError(
            `Only one flag can read from stdin. Found: --${stdinFlag}, --${key}`,
            ExitCode.VALIDATION,
          );
        }
        stdinFlag = key;
        i += 2;
      } else if (nextArg !== undefined && !nextArg.startsWith("--")) {
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

  return { resource, action, id, namespacePrefix, options, globalFlags, stdinFlag };
}
