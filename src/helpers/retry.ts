import { logger } from "./logger.ts";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Generic async retry with exponential backoff.
 * Retries on network errors and specified HTTP status codes.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    isRetryable = defaultIsRetryable,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.debug(
        `Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function defaultIsRetryable(error: unknown): boolean {
  // Network errors (fetch failures, DNS, connection refused)
  if (error instanceof TypeError) return true;

  // Check for HTTP status-based errors
  if (error instanceof Error && "status" in error) {
    const status = (error as Error & { status: number }).status;
    return RETRYABLE_STATUS_CODES.has(status);
  }

  return false;
}

/** Check if an HTTP status code should be retried. */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
