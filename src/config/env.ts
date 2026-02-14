import type { EnvConfig } from "../types/config.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENV_KEYS = [
  "WP_HOST",
  "WP_USERNAME",
  "WP_APPLICATION_PASSWORD",
  "WP_API_PREFIX",
  "WP_PER_PAGE",
  "WP_TIMEOUT",
  "WP_VERIFY_SSL",
  "WP_OUTPUT_FORMAT",
] as const;

/** Parse .env file and return typed config. */
export function loadEnvConfig(envPath?: string): EnvConfig {
  const filePath = envPath ?? join(process.cwd(), ".env");

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    // .env file doesn't exist — return empty config (not an error by itself)
    return {};
  }

  const vars = parseEnvContent(content);

  // Also merge any matching process.env vars (they take precedence)
  for (const key of ENV_KEYS) {
    if (process.env[key] !== undefined) {
      vars[key] = process.env[key]!;
    }
  }

  return mapToConfig(vars);
}

function parseEnvContent(content: string): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return vars;
}

function mapToConfig(vars: Record<string, string>): EnvConfig {
  const config: EnvConfig = {};

  if (vars["WP_HOST"]) config.host = vars["WP_HOST"];
  if (vars["WP_USERNAME"]) config.username = vars["WP_USERNAME"];
  if (vars["WP_APPLICATION_PASSWORD"])
    config.application_password = vars["WP_APPLICATION_PASSWORD"];
  if (vars["WP_API_PREFIX"]) config.api_prefix = vars["WP_API_PREFIX"];
  if (vars["WP_PER_PAGE"]) config.per_page = parseInt(vars["WP_PER_PAGE"], 10);
  if (vars["WP_TIMEOUT"]) config.timeout = parseInt(vars["WP_TIMEOUT"], 10);
  if (vars["WP_VERIFY_SSL"])
    config.verify_ssl = vars["WP_VERIFY_SSL"].toLowerCase() !== "false";
  if (vars["WP_OUTPUT_FORMAT"])
    config.output_format = vars["WP_OUTPUT_FORMAT"];

  return config;
}
