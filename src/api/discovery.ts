import type { DiscoveredSchema, Route, RouteParam } from "../types/api.ts";
import { WpClient } from "./client.ts";
import type { ResolvedConfig } from "../types/config.ts";

interface WpRouteEndpoint {
  methods: string[];
  args: Record<
    string,
    {
      type?: string;
      required?: boolean;
      description?: string;
      enum?: string[];
      default?: unknown;
    }
  >;
}

interface WpRouteDefinition {
  namespace: string;
  methods: string[];
  endpoints: WpRouteEndpoint[];
}

interface WpIndexResponse {
  url: string;
  namespaces: string[];
  routes: Record<string, WpRouteDefinition>;
}

/**
 * Fetches the WordPress REST API index and parses route metadata.
 */
export async function discoverSchema(
  config: ResolvedConfig,
): Promise<DiscoveredSchema> {
  const client = new WpClient(config);
  const response = await client.get<WpIndexResponse>("");

  const index = response.data;
  const routes: Route[] = [];

  for (const [path, definition] of Object.entries(index.routes)) {
    // Merge params from all endpoints
    const allMethods = new Set<string>();
    const allParams: Map<string, RouteParam> = new Map();

    for (const endpoint of definition.endpoints) {
      for (const method of endpoint.methods) {
        allMethods.add(method);
      }

      for (const [paramName, paramDef] of Object.entries(endpoint.args)) {
        if (!allParams.has(paramName)) {
          allParams.set(paramName, {
            name: paramName,
            type: paramDef.type ?? "string",
            required: paramDef.required ?? false,
            description: paramDef.description,
            enum: paramDef.enum,
            default: paramDef.default,
          });
        }
      }
    }

    routes.push({
      path,
      methods: Array.from(allMethods),
      params: Array.from(allParams.values()),
      namespace: definition.namespace,
    });
  }

  return {
    routes,
    namespaces: index.namespaces,
    url: index.url,
    discoveredAt: new Date().toISOString(),
  };
}
