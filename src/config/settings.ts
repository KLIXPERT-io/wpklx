import type { EnvConfig, YamlProfile, ResolvedConfig } from "../types/config.ts";
import type { GlobalFlags } from "../types/cli.ts";
import { ConfigError } from "./profiles.ts";

const DEFAULTS: Omit<
  ResolvedConfig,
  "host" | "username" | "application_password"
> = {
  api_prefix: "/wp-json",
  per_page: 20,
  timeout: 30000,
  verify_ssl: true,
  output_format: "table",
};

/**
 * Merges config from all sources in order:
 * CLI flags > .env file > active YAML profile > built-in defaults
 */
export function resolveConfig(opts: {
  cliFlags: GlobalFlags;
  envConfig: EnvConfig;
  yamlProfile: YamlProfile | null;
  profileName?: string | null;
}): ResolvedConfig {
  const { cliFlags, envConfig, yamlProfile, profileName } = opts;

  // Layer: defaults <- yaml <- env <- cli
  const host =
    envConfig.host ?? yamlProfile?.host;
  const username =
    envConfig.username ?? yamlProfile?.username;
  const applicationPassword =
    envConfig.application_password ?? yamlProfile?.application_password;

  if (!host || !username || !applicationPassword) {
    throw new ConfigError(
      "Missing required configuration: host, username, and application_password must be set. " +
        "Configure via .env file, YAML profile, or CLI flags.",
    );
  }

  const config: ResolvedConfig = {
    host,
    username,
    application_password: applicationPassword,
    api_prefix:
      envConfig.api_prefix ??
      yamlProfile?.api_prefix ??
      DEFAULTS.api_prefix,
    per_page:
      cliFlags.per_page ??
      envConfig.per_page ??
      yamlProfile?.per_page ??
      DEFAULTS.per_page,
    timeout:
      envConfig.timeout ??
      yamlProfile?.timeout ??
      DEFAULTS.timeout,
    verify_ssl:
      envConfig.verify_ssl ??
      yamlProfile?.verify_ssl ??
      DEFAULTS.verify_ssl,
    output_format:
      cliFlags.format ??
      envConfig.output_format ??
      yamlProfile?.output_format ??
      DEFAULTS.output_format,
    cache_ttl: yamlProfile?.cache_ttl,
  };

  if (profileName) {
    config.profile_name = profileName;
  }

  return config;
}
