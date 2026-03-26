import * as readline from "node:readline";
import { safeExit } from "../helpers/exit.ts";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { stringify, parse } from "yaml";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function style(text: string, code: string): string {
  return `${code}${text}${ANSI.reset}`;
}

/** Prompt for input with a default value. Returns trimmed string. */
function promptInput(question: string, defaultValue?: string): string {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = prompt(`${question}${suffix}:`);
  const value = answer?.trim() || defaultValue || "";
  return value;
}

/** Prompt yes/no. Returns true for yes. */
function promptConfirm(question: string, defaultYes = true): boolean {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = prompt(`${question} ${hint}:`);
  if (!answer || !answer.trim()) return defaultYes;
  return /^y(es)?$/i.test(answer.trim());
}

/** Prompt for a password with masked input (characters hidden). */
function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const originalWrite = process.stdout.write.bind(process.stdout);
    let muted = false;

    process.stdout.write = ((
      chunk: string | Uint8Array,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      if (muted) {
        return true;
      }
      if (typeof encodingOrCb === "function") {
        return originalWrite(chunk, encodingOrCb);
      }
      return originalWrite(chunk, encodingOrCb, cb);
    }) as typeof process.stdout.write;

    rl.question(`${question}: `, (answer) => {
      muted = false;
      process.stdout.write = originalWrite;
      console.log();
      rl.close();
      resolve(answer.trim());
    });

    muted = true;
  });
}

/** Normalize a host URL: add https:// if no scheme, strip trailing slashes. */
export function normalizeHost(input: string): string {
  let url = input.trim();
  if (!url) return url;

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  url = url.replace(/\/+$/, "");
  return url;
}

export interface LoginCredentials {
  host: string;
  username: string;
  applicationPassword: string;
  profileName: string;
}

export type ConfigScope = "global" | "local";

export interface ConfigScopeResult {
  scope: ConfigScope;
  configPath: string;
  setAsDefault: boolean;
}

export interface ValidationResult {
  success: boolean;
  displayName?: string;
  errorType?: "auth" | "network" | "ssl";
  errorMessage?: string;
}

/** Validate credentials by calling GET /wp-json/wp/v2/users/me */
export async function validateCredentials(
  host: string,
  username: string,
  applicationPassword: string,
): Promise<ValidationResult> {
  const url = `${host}/wp-json/wp/v2/users/me`;
  const authHeader = `Basic ${btoa(`${username}:${applicationPassword}`)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const data = (await response.json()) as { name?: string };
      return { success: true, displayName: data.name ?? username };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        errorType: "auth",
        errorMessage: "Authentication failed. Check your username and application password.",
      };
    }

    return {
      success: false,
      errorType: "network",
      errorMessage: `Unexpected response (${response.status}) from ${url}`,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    if (
      err.message.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
      err.message.includes("CERT_") ||
      err.message.includes("certificate") ||
      err.message.includes("SSL")
    ) {
      return {
        success: false,
        errorType: "ssl",
        errorMessage: `SSL certificate verification failed for ${host}.\nConsider adding verify_ssl: false to your config or checking the certificate.`,
      };
    }

    return {
      success: false,
      errorType: "network",
      errorMessage: `Could not connect to ${host}. Check the URL and your network connection.`,
    };
  }
}

/** Prompt the user to choose config scope and default profile setting. */
export function chooseConfigScope(
  profileName: string,
): ConfigScopeResult {
  const globalPath = join(homedir(), ".config", "wpklx", "config.yaml");
  const localPath = join(process.cwd(), "wpklx.config.yaml");

  // Ask: global or local?
  console.log("\nWhere should this profile be saved?");
  console.log(`  1) ${style("Global", ANSI.bold)} — ~/.config/wpklx/config.yaml (all projects)`);
  console.log(`  2) ${style("Local", ANSI.bold)}  — ./wpklx.config.yaml (this project only)`);
  const scopeAnswer = promptInput("Choose", "1");
  const scope: ConfigScope = scopeAnswer === "2" ? "local" : "global";
  const configPath = scope === "global" ? globalPath : localPath;

  // Ask: set as default?
  // Default to yes if profile is named "default" or if it's the only/first profile
  const isDefaultName = profileName === "default";
  const setAsDefault = promptConfirm(
    "Set this profile as the default?",
    isDefaultName,
  );

  return { scope, configPath, setAsDefault };
}

/** Save credentials to a YAML config file, merging with existing profiles. */
export function saveConfig(
  configPath: string,
  profileName: string,
  credentials: LoginCredentials,
  setAsDefault: boolean,
): void {
  // Load existing config or create new
  let configData: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, "utf-8");
    configData = (parse(content) as Record<string, unknown>) ?? {};
  }

  // Ensure profiles section exists
  if (!configData["profiles"] || typeof configData["profiles"] !== "object") {
    configData["profiles"] = {};
  }

  const profiles = configData["profiles"] as Record<string, unknown>;

  // Add the new profile
  profiles[profileName] = {
    host: credentials.host,
    username: credentials.username,
    application_password: credentials.applicationPassword,
  };

  // Set as default if requested
  if (setAsDefault) {
    configData["default"] = profileName;
  }

  // Create parent directories if needed
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write YAML with 2-space indentation
  const yamlContent = stringify(configData, { indent: 2 });
  writeFileSync(configPath, yamlContent, { mode: 0o600 });

  // Ensure permissions are set (in case file already existed)
  chmodSync(configPath, 0o600);
}

/**
 * Interactive login command — guides users through WordPress site setup.
 * Collects credentials, validates them, and saves the config.
 */
export async function runLogin(): Promise<void> {
  console.log(
    style("\nwpklx login", ANSI.bold) +
      " — Interactive WordPress site setup\n",
  );

  let credentials = await collectCredentials();
  let displayName = "";

  // Validate credentials with retry loop
  while (true) {
    console.log(`\n${style("Validating credentials...", ANSI.dim)}`);

    const result = await validateCredentials(
      credentials.host,
      credentials.username,
      credentials.applicationPassword,
    );

    if (result.success) {
      displayName = result.displayName!;
      console.log(
        style(`  Authenticated as ${displayName}`, ANSI.green),
      );
      break;
    }

    // Show error
    console.log(`\n${style(result.errorMessage!, ANSI.red)}`);

    if (result.errorType === "auth") {
      const retry = promptConfirm("Re-enter username and password?");
      if (!retry) await safeExit(1);

      credentials.username = promptInput("WordPress username");
      if (!credentials.username) await safeExit(1);

      const rawPassword = await promptPassword("Application password");
      if (!rawPassword) await safeExit(1);
      credentials.applicationPassword = rawPassword.replace(/\s/g, "");
    } else if (result.errorType === "network" || result.errorType === "ssl") {
      const retry = promptConfirm("Re-enter host URL?");
      if (!retry) await safeExit(1);

      const rawHost = promptInput("WordPress site URL (e.g., example.com)");
      if (!rawHost) await safeExit(1);
      credentials.host = normalizeHost(rawHost);
    } else {
      await safeExit(1);
    }
  }

  // Choose config scope and default setting
  const { scope, configPath, setAsDefault } = chooseConfigScope(
    credentials.profileName,
  );

  // Save config
  saveConfig(configPath, credentials.profileName, credentials, setAsDefault);

  // Success output
  console.log(`\n${style("Login successful!", ANSI.bold)}\n`);
  console.log(`  ${style("Config:", ANSI.dim)}   ${configPath}`);
  console.log(`  ${style("Profile:", ANSI.dim)}  ${credentials.profileName}`);
  console.log(`  ${style("User:", ANSI.dim)}     ${displayName}`);

  if (scope === "global") {
    console.log(`\n  ${style("This config applies to all projects.", ANSI.dim)}`);
  }

  // Show next steps
  const profileArg =
    setAsDefault ? "" : ` @${credentials.profileName}`;
  console.log(`\n${style("Try it out:", ANSI.dim)}`);
  console.log(style(`  wpklx${profileArg} post list`, ANSI.cyan));
  console.log();
}

/** Collect all credentials via interactive prompts. */
export async function collectCredentials(): Promise<LoginCredentials> {
  // 1. WordPress site URL
  console.log(style("  The CLI will connect to {url}/wp-json to discover the API.", ANSI.dim));
  console.log();
  const rawHost = promptInput("WordPress site URL (e.g., myblog.com or https://myblog.com/wp)");
  if (!rawHost) {
    console.error("Host URL is required.");
    await safeExit(1);
  }
  const host = normalizeHost(rawHost);

  // 2. Show application password URL and guidance
  const appPasswordUrl = `${host}/wp-admin/authorize-application.php`;
  console.log(
    `\n${style("To authenticate, you need an Application Password (not your login password).", ANSI.dim)}`,
  );
  console.log(style(`  Create one at: ${appPasswordUrl}`, ANSI.cyan));
  console.log();

  // 3. Username
  console.log(style("  The username you log in to wp-admin with.", ANSI.dim));
  const username = promptInput("WordPress username");
  if (!username) {
    console.error("Username is required.");
    await safeExit(1);
  }

  // 4. Application password (masked input, strip whitespace)
  console.log(style("\n  Paste the application password generated above. It looks like: XXXX XXXX XXXX XXXX XXXX XXXX", ANSI.dim));
  const rawPassword = await promptPassword("Application password");
  if (!rawPassword) {
    console.error("Application password is required.");
    await safeExit(1);
  }
  const applicationPassword = rawPassword.replace(/\s/g, "");

  // 5. Profile name
  console.log(style("\n  Profiles let you manage multiple sites. Use a short name like \"production\" or \"staging\".", ANSI.dim));
  const profileName = promptInput("Profile name", "default");

  return { host, username, applicationPassword, profileName };
}
