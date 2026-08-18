import type {
  Ability,
  AbilityCategory,
  DiscoveredSchema,
} from "../types/api.ts";
import type { WpClient } from "./client.ts";
import { CliError, ExitCode } from "../helpers/error.ts";
import { logger } from "../helpers/logger.ts";

/** REST namespace of the WordPress Abilities API (WordPress 6.9+). */
export const ABILITIES_NAMESPACE = "wp-abilities/v1";

const BASE = `/${ABILITIES_NAMESPACE}`;

/** Documented maximum for per_page on the abilities collection endpoints. */
const MAX_PER_PAGE = 100;

/** HTTP methods the /run endpoint accepts, depending on the ability's annotations. */
export type RunMethod = "GET" | "POST" | "DELETE";

/** True if the site exposes the Abilities API. */
export function hasAbilitiesApi(schema: DiscoveredSchema): boolean {
  return schema.namespaces.some(
    (ns) => ns === ABILITIES_NAMESPACE || ns.startsWith("wp-abilities/"),
  );
}

/**
 * Path layouts WordPress has used for the per-ability routes.
 *
 * - `abilities` — what core registers: the whole name, slashes included, is a
 *   single `{name}` segment under `/abilities`.
 * - `legacy` — the pre-core layout, where namespace and ability were separate
 *   path segments directly under the API namespace.
 */
export type AbilityRouteShape = "abilities" | "legacy";

/** Mirrors core's `(?P<name>[a-zA-Z0-9\-\/]+)` route regex. */
const ABILITY_NAME_PATTERN = /^[a-zA-Z0-9\-/]+$/;

/**
 * Normalises a fully qualified ability name ("my-plugin/get-site-info").
 *
 * The name is one opaque identifier that may contain slashes — it is not
 * limited to two segments — so this only strips stray slashes and rejects
 * characters core's route regex would not match.
 */
export function normalizeAbilityName(name: string): string {
  let value = name.trim().replace(/^\/+|\/+$/g, "");

  // Accept the REST path form that the site's own `_links` expose, but only
  // when something with a slash remains — an ability really named
  // "abilities/foo" is legal.
  const prefix = "abilities/";
  if (value.startsWith(prefix) && value.slice(prefix.length).includes("/")) {
    value = value.slice(prefix.length);
  }

  if (!value || value.includes("//") || !ABILITY_NAME_PATTERN.test(value)) {
    throw new CliError(
      `Invalid ability name: '${name}'.\n\n` +
        `Abilities are named <namespace>/<ability>, for example:\n` +
        `  wpklx ability get my-plugin/get-site-info\n` +
        `  wpklx ability run my-plugin/get-site-info\n\n` +
        `Names may only contain letters, digits, '-' and '/'.\n` +
        `Run 'wpklx ability list' to see the abilities this site exposes.`,
      ExitCode.VALIDATION,
    );
  }
  return value;
}

/**
 * Reads the per-ability route layout off the site's own route index.
 *
 * WordPress 6.9 and 7.0 disagree on where a single ability lives, so prefer
 * what the site advertises over either hardcoded shape. Falls back to the core
 * layout when the index is unavailable or says nothing useful.
 */
export function detectAbilityRouteShape(
  schema: DiscoveredSchema | null | undefined,
): AbilityRouteShape {
  const paths = (schema?.routes ?? [])
    .filter((route) => route.namespace === ABILITIES_NAMESPACE)
    .map((route) => route.path);

  if (paths.some((path) => path.startsWith(`${BASE}/abilities/`))) {
    return "abilities";
  }
  if (paths.some((path) => path.includes("(?P<namespace>"))) {
    logger.debug(
      "Site exposes the pre-core Abilities API route layout — using /{namespace}/{ability}",
    );
    return "legacy";
  }
  return "abilities";
}

/** The paths wpklx calls for one site, resolved for its route layout. */
export interface AbilityRoutes {
  shape: AbilityRouteShape;
  abilities: string;
  categories: string;
  ability(name: string): string;
  run(name: string): string;
  category(slug: string): string;
  /** The same paths with placeholders, for help output and `wpklx routes`. */
  templates: { ability: string; run: string; category: string };
}

export function abilityRoutes(
  shape: AbilityRouteShape = "abilities",
): AbilityRoutes {
  // Only the per-ability routes moved; the collections stayed put.
  const prefix = shape === "abilities" ? `${BASE}/abilities` : BASE;
  const placeholder =
    shape === "abilities" ? "{name}" : "{namespace}/{ability}";
  const encode = (name: string) =>
    normalizeAbilityName(name).split("/").map(encodeURIComponent).join("/");

  return {
    shape,
    abilities: `${BASE}/abilities`,
    categories: `${BASE}/categories`,
    ability: (name) => `${prefix}/${encode(name)}`,
    run: (name) => `${prefix}/${encode(name)}/run`,
    category: (slug) => `${BASE}/categories/${encodeURIComponent(slug)}`,
    templates: {
      ability: `${prefix}/${placeholder}`,
      run: `${prefix}/${placeholder}/run`,
      category: `${BASE}/categories/{slug}`,
    },
  };
}

/**
 * Picks the HTTP method the /run endpoint expects for an ability:
 * read-only → GET, destructive → DELETE, everything else → POST.
 */
export function abilityRunMethod(ability: Ability): RunMethod {
  const annotations = ability.meta?.annotations ?? {};
  if (annotations.readonly) return "GET";
  if (annotations.destructive) return "DELETE";
  return "POST";
}

/** Human-readable summary of an ability's annotations, e.g. "readonly, idempotent". */
export function describeAnnotations(ability: Ability): string {
  const annotations = ability.meta?.annotations ?? {};
  const flags: string[] = [];
  if (annotations.readonly) flags.push("readonly");
  if (annotations.destructive) flags.push("destructive");
  if (annotations.idempotent) flags.push("idempotent");
  return flags.join(", ");
}

function collectionParams(opts: {
  perPage?: number;
  page?: number;
  category?: string;
}): Record<string, string> {
  const params: Record<string, string> = {};
  if (opts.perPage !== undefined && Number.isFinite(opts.perPage)) {
    const perPage = Math.min(Math.max(1, opts.perPage), MAX_PER_PAGE);
    if (perPage !== opts.perPage) {
      logger.debug(
        `per_page clamped from ${opts.perPage} to ${perPage} (Abilities API maximum is ${MAX_PER_PAGE})`,
      );
    }
    params["per_page"] = String(perPage);
  }
  if (opts.page !== undefined && Number.isFinite(opts.page)) {
    params["page"] = String(opts.page);
  }
  if (opts.category) {
    params["category"] = opts.category;
  }
  return params;
}

/** GET /wp-abilities/v1/abilities */
export async function listAbilities(
  client: WpClient,
  routes: AbilityRoutes,
  opts: { perPage?: number; page?: number; category?: string } = {},
): Promise<Ability[]> {
  const response = await client.get<Ability[]>(
    routes.abilities,
    collectionParams(opts),
  );
  return response.data;
}

/** GET /wp-abilities/v1/abilities/{name} */
export async function getAbility(
  client: WpClient,
  routes: AbilityRoutes,
  name: string,
): Promise<Ability> {
  const response = await client.get<Ability>(routes.ability(name));
  return response.data;
}

/** GET /wp-abilities/v1/categories */
export async function listCategories(
  client: WpClient,
  routes: AbilityRoutes,
  opts: { perPage?: number; page?: number } = {},
): Promise<AbilityCategory[]> {
  const response = await client.get<AbilityCategory[]>(
    routes.categories,
    collectionParams(opts),
  );
  return response.data;
}

/** GET /wp-abilities/v1/categories/{slug} */
export async function getCategory(
  client: WpClient,
  routes: AbilityRoutes,
  slug: string,
): Promise<AbilityCategory> {
  const response = await client.get<AbilityCategory>(routes.category(slug));
  return response.data;
}

export interface RunResult {
  /** The HTTP method that actually executed the ability. */
  method: RunMethod;
  data: unknown;
}

/**
 * Executes an ability via GET|POST|DELETE /wp-abilities/v1/abilities/{name}/run.
 *
 * GET and DELETE pass the input as bracket-encoded query params
 * (`input[key]=value`) — core validates `input` against the ability's schema
 * before any coercion, so a JSON-encoded string is rejected as "not of type
 * object". POST sends `{ "input": ... }` as the JSON body.
 *
 * When the method is not forced, the remaining methods are retried if the site
 * answers `rest_no_route` — the ability exists, so a 404 means only that its
 * annotations map to a different method than we inferred. Nothing ran, so the
 * retry cannot repeat a side effect.
 */
export async function runAbility(
  client: WpClient,
  routes: AbilityRoutes,
  name: string,
  input: unknown,
  forcedMethod?: RunMethod,
): Promise<RunResult> {
  const path = routes.run(name);

  let candidates: RunMethod[];
  if (forcedMethod) {
    candidates = [forcedMethod];
  } else {
    const definition = await getAbility(client, routes, name);
    const preferred = abilityRunMethod(definition);
    candidates = [
      preferred,
      ...(["GET", "POST", "DELETE"] as RunMethod[]).filter(
        (m) => m !== preferred,
      ),
    ];
  }

  for (const method of candidates) {
    try {
      const data = await execute(client, path, method, input);
      return { method, data };
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== "rest_no_route") {
        throw error;
      }
      logger.debug(
        `${method} ${path} → rest_no_route, trying the next allowed method`,
      );
    }
  }

  throw new CliError(
    forcedMethod
      ? `Ability '${name}' does not accept ${forcedMethod} on its /run endpoint.\n\n` +
          `The method is fixed by the ability's annotations:\n` +
          `  readonly: true    → GET\n` +
          `  destructive: true → DELETE\n` +
          `  otherwise         → POST\n\n` +
          `Drop --method to let wpklx pick it, or inspect the annotations with:\n` +
          `  wpklx ability get ${name}`
      : `Ability '${name}' rejected GET, POST and DELETE on its /run endpoint.\n\n` +
          `The ability is registered but not runnable over REST. Check that it was\n` +
          `registered with an execute_callback and 'show_in_rest' enabled.`,
    ExitCode.NOT_FOUND,
    "rest_no_route",
  );
}

async function execute(
  client: WpClient,
  path: string,
  method: RunMethod,
  input: unknown,
): Promise<unknown> {
  if (method === "POST") {
    const body = input === undefined ? {} : { input };
    const response = await client.post(path, body);
    return response.data;
  }

  const params = input === undefined ? undefined : bracketParams("input", input);

  const response =
    method === "GET"
      ? await client.get(path, params)
      : await client.delete(path, params);
  return response.data;
}

/**
 * Flattens a value into PHP-style bracketed query params, so that
 * `{ limit: 2, filter: { status: "publish" } }` becomes
 * `input[limit]=2&input[filter][status]=publish`.
 *
 * This is the only encoding core accepts for `input` on GET and DELETE: the
 * `input` arg is typed as object/array/scalar and validated before sanitising,
 * so a JSON string never passes.
 */
export function bracketParams(
  key: string,
  value: unknown,
): Record<string, string> {
  const params: Record<string, string> = {};

  const walk = (prefix: string, current: unknown): void => {
    if (current === undefined) return;
    if (current === null) {
      params[prefix] = "";
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(`${prefix}[${index}]`, item));
      return;
    }
    if (typeof current === "object") {
      for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
        walk(`${prefix}[${k}]`, v);
      }
      return;
    }
    // Booleans stringify to "true"/"false", which rest_sanitize_boolean accepts.
    params[prefix] = String(current);
  };

  walk(key, value);
  return params;
}
