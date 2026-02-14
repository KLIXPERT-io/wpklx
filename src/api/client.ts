import type { ResolvedConfig } from "../types/config.ts";
import type { ApiResponse, ApiError } from "../types/api.ts";
import { withRetry, isRetryableStatus } from "../helpers/retry.ts";
import {
  formatApiError,
  formatNetworkError,
  CliError,
} from "../helpers/error.ts";
import { logger } from "../helpers/logger.ts";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class WpClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeout: number;
  private readonly verifySsl: boolean;

  constructor(private readonly config: ResolvedConfig) {
    this.baseUrl = `${config.host}${config.api_prefix}`;
    this.authHeader = `Basic ${btoa(`${config.username}:${config.application_password}`)}`;
    this.timeout = config.timeout;
    this.verifySsl = config.verify_ssl;
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>("GET", path, { params });
  }

  async post<T = unknown>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>("POST", path, { body });
  }

  async put<T = unknown>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>("PUT", path, { body });
  }

  async patch<T = unknown>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>("PATCH", path, { body });
  }

  async delete<T = unknown>(
    path: string,
    params?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>("DELETE", path, { params });
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    opts: {
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<ApiResponse<T>> {
    let url = `${this.baseUrl}${path}`;
    if (opts.params) {
      const searchParams = new URLSearchParams(opts.params);
      url += `?${searchParams.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
    };

    if (opts.body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      headers["Content-Type"] = "application/json";
    }

    const fetchOpts: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    };

    if (opts.body) {
      fetchOpts.body = JSON.stringify(opts.body);
    }

    if (!this.verifySsl) {
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
    }

    const start = performance.now();

    logger.debug(`${method} ${url}`);
    logger.debug(
      `Headers: ${JSON.stringify({ ...headers, Authorization: "Basic ****" })}`,
    );

    return withRetry(
      async () => {
        let response: Response;
        try {
          response = await fetch(url, fetchOpts);
        } catch (error) {
          throw formatNetworkError(
            error instanceof Error ? error : new Error(String(error)),
            this.config.host,
          );
        }

        const elapsed = Math.round(performance.now() - start);
        logger.debug(`Response: ${response.status} (${elapsed}ms)`);

        if (!response.ok) {
          let body: ApiError;
          try {
            body = (await response.json()) as ApiError;
          } catch {
            body = { code: "unknown", message: response.statusText };
          }

          const error = formatApiError(response.status, body);

          // If retryable, throw with status for retry logic
          if (isRetryableStatus(response.status)) {
            const retryError = new Error(error.message) as Error & {
              status: number;
            };
            retryError.status = response.status;
            throw retryError;
          }

          throw error;
        }

        const data = (await response.json()) as T;
        return {
          status: response.status,
          data,
          headers: response.headers,
        };
      },
      {
        isRetryable: (error) => {
          if (error instanceof CliError) return false;
          if (error instanceof TypeError) return true;
          if (error instanceof Error && "status" in error) {
            return isRetryableStatus(
              (error as Error & { status: number }).status,
            );
          }
          return false;
        },
      },
    );
  }
}
