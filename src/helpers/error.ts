import { logger } from "./logger.ts";
import { safeExit } from "./exit.ts";
import type { ApiError } from "../types/api.ts";

/** Exit codes as defined in CLAUDE.md */
export const ExitCode = {
  SUCCESS: 0,
  GENERAL: 1,
  CONFIG: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  VALIDATION: 5,
  NETWORK: 6,
} as const;

export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** Formats a WordPress REST API error response into a human-readable message. */
export function formatApiError(
  status: number,
  body: ApiError,
): CliError {
  const apiMessage = body.message || body.code || "Unknown error";

  switch (status) {
    case 401:
    case 403:
      return new CliError(
        `Authentication failed: ${apiMessage}\n\n` +
          `The username or application password was rejected by the WordPress site.\n\n` +
          `To fix:\n` +
          `  1. Verify your username: wpklx config show (check "username" field)\n` +
          `  2. Regenerate an application password: WP Admin → Users → Profile → Application Passwords\n` +
          `  3. Update your profile: wpklx config rm <name> && wpklx login`,
        ExitCode.AUTH,
      );

    case 404:
      return new CliError(
        `Not found: ${apiMessage}\n\n` +
          `The requested resource or item does not exist on this WordPress site.\n\n` +
          `To fix:\n` +
          `  1. Check the resource name: wpklx routes (lists all available resources)\n` +
          `  2. Verify the item ID exists on the site\n` +
          `  3. Check that your user has permission to access this resource`,
        ExitCode.NOT_FOUND,
      );

    case 400:
    case 422: {
      let msg = `Validation error: ${apiMessage}`;
      if (body.data?.params) {
        msg += `\n\nInvalid fields:`;
        const fields = Object.entries(body.data.params)
          .map(([field, error]) => `  - ${field}: ${error}`)
          .join("\n");
        msg += `\n${fields}`;
      }
      if (body.data?.details) {
        msg += `\n\nField details:`;
        const details = Object.entries(body.data.details)
          .map(([field, detail]) => `  - ${field}: ${detail.message}`)
          .join("\n");
        msg += `\n${details}`;
      }
      msg += `\n\nTo fix:\n` +
        `  1. Check required fields: wpklx <resource> help\n` +
        `  2. Verify field values match the expected types and allowed values`;
      return new CliError(msg, ExitCode.VALIDATION);
    }

    default:
      return new CliError(
        `API error (${status}): ${apiMessage}`,
        ExitCode.GENERAL,
      );
  }
}

/** Formats a network error (connection failed, DNS, etc.) */
export function formatNetworkError(error: Error, host?: string): CliError {
  const hostInfo = host ?? "the server";

  if (error.name === "AbortError" || error.message.includes("timed out")) {
    return new CliError(
      `Request to ${hostInfo} timed out.\n\n` +
        `The server did not respond within the configured timeout period.\n\n` +
        `To fix:\n` +
        `  1. Increase timeout: set WP_TIMEOUT=30000 in .env (value in milliseconds)\n` +
        `  2. Or add timeout: 30000 to your profile in wpklx.config.yaml\n` +
        `  3. Check if the WordPress site is up by visiting it in a browser`,
      ExitCode.NETWORK,
    );
  }

  if (
    error.message.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
    error.message.includes("CERT_") ||
    error.message.includes("certificate")
  ) {
    return new CliError(
      `SSL certificate verification failed for ${hostInfo}.\n\n` +
        `The server's SSL certificate could not be verified.\n\n` +
        `To fix:\n` +
        `  1. For local/dev environments: set WP_VERIFY_SSL=false in .env\n` +
        `     or add verify_ssl: false to your profile in wpklx.config.yaml\n` +
        `  2. For production: ensure the site has a valid SSL certificate\n` +
        `  3. Check if the URL is correct: wpklx config show`,
      ExitCode.NETWORK,
    );
  }

  if (error.message.includes("ENOTFOUND") || error.message.includes("getaddrinfo")) {
    return new CliError(
      `DNS resolution failed for ${hostInfo}.\n\n` +
        `The hostname could not be resolved to an IP address.\n\n` +
        `To fix:\n` +
        `  1. Check the URL is correct: wpklx config show\n` +
        `  2. Verify your DNS and internet connection\n` +
        `  3. Try using the IP address directly if DNS is unreliable`,
      ExitCode.NETWORK,
    );
  }

  if (error.message.includes("ECONNREFUSED")) {
    return new CliError(
      `Connection refused by ${hostInfo}.\n\n` +
        `The server actively refused the connection.\n\n` +
        `To fix:\n` +
        `  1. Check if the WordPress site is running\n` +
        `  2. Verify the URL and port: wpklx config show\n` +
        `  3. Check if a firewall is blocking the connection`,
      ExitCode.NETWORK,
    );
  }

  return new CliError(
    `Could not connect to ${hostInfo}.\n\n` +
      `To fix:\n` +
      `  1. Check the URL is correct: wpklx config show\n` +
      `  2. Verify your network connection\n` +
      `  3. Check if the WordPress site is up`,
    ExitCode.NETWORK,
  );
}

/** Handles an error by logging it and exiting with the correct code. */
export async function handleError(error: unknown): Promise<never> {
  if (error instanceof CliError) {
    logger.error(error.message);
    await safeExit(error.exitCode);
  }

  if (error instanceof Error) {
    logger.error(error.message);
    await safeExit(ExitCode.GENERAL);
  }

  logger.error(String(error));
  await safeExit(ExitCode.GENERAL);
}
