import { parse } from "yaml";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { YamlConfig, YamlProfile } from "../types/config.ts";

const CONFIG_FILENAME = "wpklx.config.yaml";

/** Searches for the YAML config file in standard locations. */
export function findConfigPath(): string | null {
  // 1. Check current directory
  const localPath = join(process.cwd(), CONFIG_FILENAME);
  if (existsSync(localPath)) return localPath;

  // 2. Check ~/.config/wpklx/
  const globalPath = join(homedir(), ".config", "wpklx", "config.yaml");
  if (existsSync(globalPath)) return globalPath;

  return null;
}

/** Loads and parses the YAML config file. */
export function loadYamlConfig(configPath?: string): YamlConfig | null {
  const path = configPath ?? findConfigPath();
  if (!path) return null;

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return null;
  }

  const parsed = parse(content) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new ConfigError("Invalid YAML config file: expected an object");
  }

  const profiles = parsed["profiles"];
  if (!profiles || typeof profiles !== "object") {
    throw new ConfigError(
      "Invalid YAML config: missing 'profiles' section",
    );
  }

  return {
    default: typeof parsed["default"] === "string" ? parsed["default"] : undefined,
    profiles: profiles as Record<string, YamlProfile>,
  };
}

/** Resolves the active profile from the YAML config. */
export function resolveProfile(
  config: YamlConfig,
  profileName?: string,
): YamlProfile {
  const name = profileName ?? config.default;

  if (!name) {
    throw new ConfigError(
      "No profile specified and no 'default' profile set in config. " +
        "Use @name to specify a profile or set 'default' in your config file.",
    );
  }

  const profile = config.profiles[name];
  if (!profile) {
    const available = Object.keys(config.profiles).join(", ");
    throw new ConfigError(
      `Profile '${name}' not found. Available profiles: ${available}`,
    );
  }

  // Validate required fields
  if (!profile.host) {
    throw new ConfigError(`Profile '${name}' is missing required field 'host'`);
  }
  if (!profile.username) {
    throw new ConfigError(
      `Profile '${name}' is missing required field 'username'`,
    );
  }
  if (!profile.application_password) {
    throw new ConfigError(
      `Profile '${name}' is missing required field 'application_password'`,
    );
  }

  return profile;
}

export class ConfigError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
