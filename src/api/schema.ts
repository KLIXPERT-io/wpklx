import type { DiscoveredSchema, RouteParam } from "../types/api.ts";
import type { CommandParam } from "../types/cli.ts";

export interface CommandMeta {
  method: string;
  path: string;
  params: CommandParam[];
}

export type CommandMap = Record<string, Record<string, CommandMeta>>;

/**
 * Maps discovered REST routes to CLI command metadata.
 * Groups by resource name with actions (list, get, create, update, delete).
 * When namespaceFilter is provided, only routes from that namespace are included.
 */
export function mapRoutesToCommands(
  schema: DiscoveredSchema,
  namespaceFilter?: string,
): CommandMap {
  const commands: CommandMap = {};

  // Sort routes so wp/v2 (core) routes are processed first.
  // Combined with first-match-wins below, this ensures core routes
  // take priority over plugin routes sharing the same resource name.
  const sortedRoutes = [...schema.routes].sort((a, b) => {
    const aIsCore = a.namespace === "wp/v2" ? 0 : 1;
    const bIsCore = b.namespace === "wp/v2" ? 0 : 1;
    return aIsCore - bIsCore;
  });

  for (const route of sortedRoutes) {
    // Filter by namespace if specified
    if (namespaceFilter && !route.namespace.startsWith(namespaceFilter)) {
      continue;
    }
    const resourceName = extractResourceName(route.path);
    if (!resourceName) continue;

    const singular = singularize(resourceName);
    const hasIdParam = route.path.includes("(?P<id>");

    if (!commands[singular]) {
      commands[singular] = {};
    }

    for (const method of route.methods) {
      const action = mapMethodToAction(method, hasIdParam);
      if (!action) continue;

      // Don't overwrite existing actions (first match wins)
      if (commands[singular]![action]) continue;

      commands[singular]![action] = {
        method,
        path: route.path,
        params: route.params.map(mapParam),
      };
    }
  }

  return commands;
}

/**
 * Extracts the resource name from a route path.
 * e.g., "/wp/v2/posts" -> "posts", "/my-plugin/v1/widgets" -> "widgets"
 * Ignores the ID segment: "/wp/v2/posts/(?P<id>[\d]+)" -> "posts"
 */
function extractResourceName(path: string): string | null {
  // Remove regex path params like (?P<id>[\d]+)
  const cleanPath = path.replace(/\/\(\?P<[^>]+>[^)]+\)/g, "");

  const segments = cleanPath.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  // The resource is the last meaningful segment after namespace/version
  const lastSegment = segments[segments.length - 1];
  return lastSegment ?? null;
}

/** Simple English singularization. */
function singularize(word: string): string {
  if (word.endsWith("sses")) {
    // e.g., "classes" -> "class"  but "statuses" handled below
    return word.slice(0, -2);
  }
  if (word.endsWith("ies")) {
    return word.slice(0, -3) + "y";
  }
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return word;
}

function mapMethodToAction(
  method: string,
  hasIdParam: boolean,
): string | null {
  switch (method) {
    case "GET":
      return hasIdParam ? "get" : "list";
    case "POST":
      return hasIdParam ? null : "create";
    case "PUT":
    case "PATCH":
      return hasIdParam ? "update" : null;
    case "DELETE":
      return hasIdParam ? "delete" : null;
    default:
      return null;
  }
}

function mapParam(param: RouteParam): CommandParam {
  return {
    name: param.name,
    type: param.type,
    required: param.required,
    description: param.description,
    enum: param.enum,
  };
}

/**
 * Resolves a short namespace prefix (e.g., "wpml") to a full namespace
 * (e.g., "wpml/v1") by matching against discovered namespaces.
 * Returns the matching namespace or null if no match found.
 */
export function resolveNamespacePrefix(
  namespaces: string[],
  prefix: string,
): string | null {
  // Exact match first
  const exact = namespaces.find((ns) => ns === prefix);
  if (exact) return exact;

  // Prefix match: "wpml" matches "wpml/v1"
  const matches = namespaces.filter((ns) => ns.startsWith(prefix + "/"));
  if (matches.length === 1) return matches[0]!;

  // If multiple matches, prefer highest version
  if (matches.length > 1) {
    return matches.sort().reverse()[0]!;
  }

  return null;
}

/** Get all unique resource names from the command map. */
export function getResourceNames(commands: CommandMap): string[] {
  return Object.keys(commands).sort();
}
