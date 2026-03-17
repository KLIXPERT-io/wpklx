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
        `Authentication failed: ${apiMessage}\n` +
          `Check your application password at WP Admin > Users > Profile > Application Passwords`,
        ExitCode.AUTH,
      );

    case 404:
      return new CliError(
        `Not found: ${apiMessage}\n` +
          `Run \`wpklx routes\` to see available commands`,
        ExitCode.NOT_FOUND,
      );

    case 400:
    case 422: {
      let msg = `Validation error: ${apiMessage}`;
      if (body.data?.params) {
        const fields = Object.entries(body.data.params)
          .map(([field, error]) => `  - ${field}: ${error}`)
          .join("\n");
        msg += `\n${fields}`;
      }
      if (body.data?.details) {
        const details = Object.entries(body.data.details)
          .map(([field, detail]) => `  - ${field}: ${detail.message}`)
          .join("\n");
        msg += `\n${details}`;
      }
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
      `Request timed out. Increase timeout with WP_TIMEOUT or --timeout`,
      ExitCode.NETWORK,
    );
  }

  if (
    error.message.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE") ||
    error.message.includes("CERT_") ||
    error.message.includes("certificate")
  ) {
    return new CliError(
      `SSL certificate verification failed. Use WP_VERIFY_SSL=false for local development`,
      ExitCode.NETWORK,
    );
  }

  return new CliError(
    `Could not connect to ${hostInfo}. Check the URL and your network connection`,
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
