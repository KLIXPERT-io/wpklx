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

export interface AbilityRef {
  namespace: string;
  ability: string;
}

/**
 * Splits a fully qualified ability name ("my-plugin/get-site-info")
 * into its namespace and ability parts.
 */
export function parseAbilityName(name: string): AbilityRef {
  const parts = name.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CliError(
      `Invalid ability name: '${name}'.\n\n` +
        `Abilities are named <namespace>/<ability>, for example:\n` +
        `  wpklx ability get my-plugin/get-site-info\n` +
        `  wpklx ability run my-plugin/get-site-info\n\n` +
        `Run 'wpklx ability list' to see the abilities this site exposes.`,
      ExitCode.VALIDATION,
    );
  }
  return { namespace: parts[0], ability: parts[1] };
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
  opts: { perPage?: number; page?: number; category?: string } = {},
): Promise<Ability[]> {
  const response = await client.get<Ability[]>(
    `${BASE}/abilities`,
    collectionParams(opts),
  );
  return response.data;
}

/** GET /wp-abilities/v1/{namespace}/{ability} */
export async function getAbility(
  client: WpClient,
  name: string,
): Promise<Ability> {
  const { namespace, ability } = parseAbilityName(name);
  const response = await client.get<Ability>(`${BASE}/${namespace}/${ability}`);
  return response.data;
}

/** GET /wp-abilities/v1/categories */
export async function listCategories(
  client: WpClient,
  opts: { perPage?: number; page?: number } = {},
): Promise<AbilityCategory[]> {
  const response = await client.get<AbilityCategory[]>(
    `${BASE}/categories`,
    collectionParams(opts),
  );
  return response.data;
}

/** GET /wp-abilities/v1/categories/{slug} */
export async function getCategory(
  client: WpClient,
  slug: string,
): Promise<AbilityCategory> {
  const response = await client.get<AbilityCategory>(
    `${BASE}/categories/${encodeURIComponent(slug)}`,
  );
  return response.data;
}

export interface RunResult {
  /** The HTTP method that actually executed the ability. */
  method: RunMethod;
  data: unknown;
}

/**
 * Executes an ability via GET|POST|DELETE /wp-abilities/v1/{namespace}/{ability}/run.
 *
 * GET and DELETE pass the input as a URL-encoded JSON `input` query param;
 * POST sends `{ "input": ... }` as the JSON body.
 *
 * When the method is not forced, the remaining methods are retried if the site
 * answers `rest_no_route` — the ability exists, so a 404 means only that its
 * annotations map to a different method than we inferred. Nothing ran, so the
 * retry cannot repeat a side effect.
 */
export async function runAbility(
  client: WpClient,
  name: string,
  input: unknown,
  forcedMethod?: RunMethod,
): Promise<RunResult> {
  const { namespace, ability } = parseAbilityName(name);
  const path = `${BASE}/${namespace}/${ability}/run`;

  let candidates: RunMethod[];
  if (forcedMethod) {
    candidates = [forcedMethod];
  } else {
    const definition = await getAbility(client, name);
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

  const params =
    input === undefined
      ? undefined
      : { input: JSON.stringify(input) };

  const response =
    method === "GET"
      ? await client.get(path, params)
      : await client.delete(path, params);
  return response.data;
}
