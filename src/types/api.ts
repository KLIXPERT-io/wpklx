/** A single parameter from a WordPress REST API route definition */
export interface RouteParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: unknown;
}

/** A parsed WordPress REST API route */
export interface Route {
  path: string;
  methods: string[];
  params: RouteParam[];
  namespace: string;
}

/** Schema discovered from a WordPress site's /wp-json endpoint */
export interface DiscoveredSchema {
  routes: Route[];
  namespaces: string[];
  url: string;
  discoveredAt: string;
}

/**
 * Execution semantics declared by an ability (WordPress Abilities API).
 * These decide which HTTP method the /run endpoint accepts.
 */
export interface AbilityAnnotations {
  instructions?: string;
  readonly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
}

/** An ability exposed by the WordPress Abilities API (WordPress 6.9+) */
export interface Ability {
  name: string;
  label?: string;
  description?: string;
  category?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  meta?: {
    annotations?: AbilityAnnotations;
    [key: string]: unknown;
  };
}

/** A category grouping abilities */
export interface AbilityCategory {
  slug: string;
  label?: string;
  description?: string;
  meta?: Record<string, unknown>;
}

/** Typed API response wrapper */
export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
}

/** WordPress REST API error shape */
export interface ApiError {
  code: string;
  message: string;
  data?: {
    status?: number;
    params?: Record<string, string>;
    details?: Record<string, { code: string; message: string }>;
  };
}
