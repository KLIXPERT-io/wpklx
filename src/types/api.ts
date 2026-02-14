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
