/** Valid values for auto_update setting */
export type AutoUpdateMode = "auto" | "notify" | "off";

/** Config values parsed from .env file — all optional since any may be absent */
export interface EnvConfig {
  host?: string;
  username?: string;
  application_password?: string;
  api_prefix?: string;
  per_page?: number;
  timeout?: number;
  verify_ssl?: boolean;
  output_format?: string;
  auto_update?: AutoUpdateMode;
}

/** A single profile from wpklx.config.yaml */
export interface YamlProfile {
  host?: string;
  username?: string;
  application_password?: string;
  api_prefix?: string;
  per_page?: number;
  timeout?: number;
  verify_ssl?: boolean;
  output_format?: string;
  cache_ttl?: number;
  auto_update?: AutoUpdateMode;
}

/** Root structure of wpklx.config.yaml */
export interface YamlConfig {
  default?: string;
  auto_update?: AutoUpdateMode;
  profiles: Record<string, YamlProfile>;
}

/** Fully resolved config with all required fields guaranteed */
export interface ResolvedConfig {
  host: string;
  username: string;
  application_password: string;
  api_prefix: string;
  per_page: number;
  timeout: number;
  verify_ssl: boolean;
  output_format: string;
  cache_ttl?: number;
  profile_name?: string;
  auto_update: AutoUpdateMode;
}
