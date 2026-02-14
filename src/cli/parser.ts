import {
  loadYamlConfig,
  resolveProfile,
  ConfigError,
} from "../config/profiles.ts";
import type { YamlProfile } from "../types/config.ts";

export interface ProfileResult {
  profileName: string | null;
  profile: YamlProfile | null;
  remainingArgs: string[];
}

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
