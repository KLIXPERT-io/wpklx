# PRD: KLX WordPress CLI

## Introduction

Build `wpklx` — a dynamic, fault-tolerant command-line interface for the WordPress REST API. Built with Bun and TypeScript, the CLI discovers available routes from a WordPress site's `/wp-json` endpoint at runtime and generates commands automatically. No hardcoded endpoints — when plugins add new routes, they become CLI commands instantly.

The CLI syntax follows `wpklx [@profile] <resource> <action> [options]`. Configuration supports `.env` files for single-site setups and YAML profiles for managing multiple WordPress sites.

## Goals

- Provide a zero-config CLI that auto-discovers WordPress REST API routes
- Support multiple WordPress sites via YAML profiles with `@name` switching
- Deliver fault-tolerant HTTP communication with retries, timeouts, and clear error messages
- Render structured output (tables, lists, JSON, YAML) using Bun's markdown renderer with ANSI terminal callbacks
- Cache discovered schemas to disk and memory for fast repeated usage with configurable TTL
- Ship as a single Bun binary named `wpklx`

## User Stories

---

### Phase 1 — Foundation

---

### US-001: Initialize Bun project scaffolding
**Description:** As a developer, I want the project set up with Bun so that I can start building the CLI with proper TypeScript support and tooling.

**Acceptance Criteria:**
- [ ] `package.json` with project name `wpklx`, `bin` field pointing to entry, and scripts: `dev`, `build`, `typecheck`, `lint`
- [ ] `tsconfig.json` configured for Bun with strict mode, path aliases if needed
- [ ] `bunfig.toml` with relevant Bun configuration
- [ ] `src/index.ts` entry point that prints version and exits
- [ ] `bun run dev` executes the CLI in development mode
- [ ] `bun run build` produces a production build
- [ ] Typecheck passes

---

### US-002: Parse .env configuration files
**Description:** As a user with a single WordPress site, I want to configure the CLI via a `.env` file so that I can get started quickly without YAML.

**Acceptance Criteria:**
- [ ] Reads `.env` from current working directory by default
- [ ] Supports `--env <path>` flag to specify a custom `.env` file path
- [ ] Parses all supported env vars: `WP_HOST`, `WP_USERNAME`, `WP_APPLICATION_PASSWORD`, `WP_API_PREFIX`, `WP_PER_PAGE`, `WP_TIMEOUT`, `WP_VERIFY_SSL`, `WP_OUTPUT_FORMAT`
- [ ] Returns a typed config object matching the `Config` type
- [ ] Throws a clear error (exit code 2) if required vars (`WP_HOST`, `WP_USERNAME`, `WP_APPLICATION_PASSWORD`) are missing
- [ ] Ignores unknown env vars without error
- [ ] Typecheck passes

---

### US-003: Parse YAML profile configuration
**Description:** As a user managing multiple WordPress sites, I want to define profiles in a YAML file so that I can switch between sites with `@name` syntax.

**Acceptance Criteria:**
- [ ] Searches for config file in order: `./wpklx.config.yaml` then `~/.config/wpklx/config.yaml`
- [ ] Parses `default` key to determine which profile to use when no `@name` is specified
- [ ] Parses `profiles` map with keys as profile names, each containing: `host`, `username`, `application_password`, `api_prefix`, `per_page`, `timeout`, `verify_ssl`, `output_format`
- [ ] Returns the active profile as a typed config object
- [ ] Throws a clear error (exit code 2) if the requested profile does not exist
- [ ] Throws a clear error (exit code 2) if required fields (`host`, `username`, `application_password`) are missing from the active profile
- [ ] Typecheck passes

---

### US-004: Resolve @profile from CLI arguments
**Description:** As a user, I want to type `@staging` anywhere in my command to switch profiles so that multi-site workflows are seamless.

**Acceptance Criteria:**
- [ ] Detects `@name` token anywhere in `process.argv`
- [ ] Extracts the profile name and removes the token from the argument list before further parsing
- [ ] If no `@name` is present, uses the `default` profile from YAML config (or falls back to `.env`)
- [ ] If `@name` is present but no YAML config exists, throws error (exit code 2) with message suggesting to create `wpklx.config.yaml`
- [ ] Typecheck passes

---

### US-005: Merge configuration from all sources
**Description:** As a user, I want CLI flags to override `.env` values, which override YAML profile values, which override defaults, so that configuration is predictable.

**Acceptance Criteria:**
- [ ] Implements merge order: CLI flags > `.env` file > active YAML profile > built-in defaults
- [ ] Built-in defaults: `api_prefix: "/wp-json"`, `per_page: 20`, `timeout: 30000`, `verify_ssl: true`, `output_format: "table"`
- [ ] CLI flags `--format`, `--per-page`, `--page`, `--env` override all other sources
- [ ] Returns a single fully-resolved `ResolvedConfig` object
- [ ] Typecheck passes

---

### US-006: Define TypeScript types for config, CLI, and API
**Description:** As a developer, I want strict TypeScript types for all data structures so that the codebase is type-safe from the start.

**Acceptance Criteria:**
- [ ] `src/types/config.ts`: `EnvConfig`, `YamlProfile`, `YamlConfig`, `ResolvedConfig` types
- [ ] `src/types/cli.ts`: `ParsedArgs`, `Command`, `GlobalFlags` types
- [ ] `src/types/api.ts`: `Route`, `RouteParam`, `DiscoveredSchema`, `ApiResponse`, `ApiError` types
- [ ] All types are exported and used consistently across modules
- [ ] Typecheck passes

---

### US-007: Parse CLI arguments into structured command
**Description:** As a user, I want to type `wpklx post list --status draft` and have it parsed into a structured command so that the CLI can route it correctly.

**Acceptance Criteria:**
- [ ] Parses `<resource>` as the first positional argument (after removing `@profile` and global flags)
- [ ] Parses `<action>` as the second positional argument
- [ ] Resolves action shortcuts: `ls`->`list`, `show`->`get`, `new`->`create`, `edit`->`update`, `rm`->`delete`
- [ ] Parses `--key value` pairs as command options
- [ ] Parses `--flag` (no value) as boolean `true`
- [ ] Detects positional ID: `wpklx post show 42` treats `42` as `--id 42`
- [ ] Extracts global flags (`--format`, `--fields`, `--per-page`, `--page`, `--quiet`, `--verbose`, `--no-color`, `--help`, `--version`, `--env`) before resource-specific options
- [ ] Returns a `ParsedArgs` object with `{ resource, action, id?, options, globalFlags }`
- [ ] Typecheck passes

---

### Phase 2 — WordPress API Core

---

### US-008: Build HTTP client with Basic Auth
**Description:** As a developer, I need an HTTP client that authenticates with WordPress application passwords so that all API calls are authorized.

**Acceptance Criteria:**
- [ ] Uses Bun's native `fetch` API
- [ ] Adds `Authorization: Basic base64(username:application_password)` header to every request
- [ ] Supports GET, POST, PUT, PATCH, DELETE methods
- [ ] Sets `Content-Type: application/json` for POST/PUT/PATCH requests
- [ ] Respects `timeout` from resolved config (uses `AbortSignal.timeout()`)
- [ ] Respects `verify_ssl` setting (Bun's `tls.rejectUnauthorized` or equivalent)
- [ ] Returns typed `ApiResponse` with `status`, `data`, `headers`
- [ ] Typecheck passes

---

### US-009: Implement retry logic with exponential backoff
**Description:** As a user, I want transient network failures to be retried automatically so that flaky connections don't block my workflow.

**Acceptance Criteria:**
- [ ] Retries on network errors and HTTP 429, 500, 502, 503, 504
- [ ] Does NOT retry on 400, 401, 403, 404, 405, 422 (client errors)
- [ ] Uses exponential backoff: 1s, 2s, 4s (3 attempts total by default)
- [ ] Logs retry attempts when `--verbose` is enabled
- [ ] After all retries exhausted, throws with the last error
- [ ] Standalone helper in `src/helpers/retry.ts` — generic, not HTTP-specific
- [ ] Typecheck passes

---

### US-010: Discover API schema from /wp-json
**Description:** As a user, I want the CLI to fetch my site's API schema so that it knows what routes and parameters are available.

**Acceptance Criteria:**
- [ ] Sends GET request to `{host}{api_prefix}` (e.g., `https://example.com/wp-json`)
- [ ] Parses the `routes` object from the response
- [ ] Extracts for each route: path pattern, HTTP methods, accepted parameters (name, type, required, description, enum values)
- [ ] Handles namespaced routes (e.g., `/wp/v2/posts`, `/my-plugin/v1/widgets`)
- [ ] Returns a `DiscoveredSchema` object containing all parsed route metadata
- [ ] Throws clear error (exit code 3) on 401/403 (auth failure)
- [ ] Throws clear error (exit code 6) on network/timeout failure
- [ ] Typecheck passes

---

### US-011: Map REST routes to CLI commands
**Description:** As a developer, I need discovered routes transformed into CLI command metadata so that the parser can match user input to API calls.

**Acceptance Criteria:**
- [ ] Maps route path to resource name: `/wp/v2/posts` -> `post`, `/wp/v2/categories` -> `category`
- [ ] Singularizes resource names for CLI friendliness (e.g., `posts` -> `post`)
- [ ] Maps HTTP methods to actions: GET (with ID param) -> `get`, GET (without) -> `list`, POST -> `create`, PUT/PATCH -> `update`, DELETE -> `delete`
- [ ] Preserves parameter metadata (name, type, required, description, enum) for each action
- [ ] Handles routes with path parameters like `/wp/v2/posts/(?P<id>[\d]+)` — extracts `id` as a required param for get/update/delete
- [ ] Handles plugin namespaces: `/my-plugin/v1/widgets` -> resource `widget`
- [ ] Returns a map of `{ [resource]: { [action]: CommandMeta } }`
- [ ] Typecheck passes

---

### US-012: Cache discovered schema to disk and memory
**Description:** As a user, I want schema discovery to be fast on repeated runs so that the CLI feels instant after the first use.

**Acceptance Criteria:**
- [ ] After successful discovery, writes schema to `~/.config/wpklx/cache/{host-hash}.json`
- [ ] On subsequent runs, loads from disk cache first, then holds in memory for the session
- [ ] Cache includes a `discoveredAt` timestamp
- [ ] Default TTL is 1 hour — if cache is older, re-discovers automatically
- [ ] TTL is configurable via `WP_CACHE_TTL` env var or `cache_ttl` profile field (in seconds)
- [ ] `wpklx discover` forces a fresh discovery regardless of cache (user override)
- [ ] `wpklx discover --force` is an alias for the same behavior
- [ ] Typecheck passes

---

### US-013: Format API errors into human-readable messages
**Description:** As a user, I want clear error messages so that I know what went wrong and how to fix it.

**Acceptance Criteria:**
- [ ] Formats WordPress REST API error responses (code + message fields) into readable output
- [ ] Auth errors (401/403): "Authentication failed. Check your application password at WP Admin > Users > Profile > Application Passwords"
- [ ] Not found (404): "Resource not found. Run `wpklx routes` to see available commands"
- [ ] Validation errors (400/422): Shows field-level validation messages from the API response
- [ ] Network errors: "Could not connect to {host}. Check the URL and your network connection"
- [ ] Timeout errors: "Request timed out after {timeout}ms. Increase timeout with WP_TIMEOUT or --timeout"
- [ ] SSL errors: "SSL certificate verification failed. Use WP_VERIFY_SSL=false for local development"
- [ ] Each error type exits with the correct exit code (1-6)
- [ ] Error output goes to stderr
- [ ] Typecheck passes

---

### Phase 3 — CLI Commands

---

### US-014: Implement `wpklx discover` command
**Description:** As a user, I want to explicitly trigger API discovery so that I can refresh the cached schema when my site's API changes.

**Acceptance Criteria:**
- [ ] Fetches schema from the configured WordPress site
- [ ] Always bypasses cache (force fresh discovery)
- [ ] Saves result to disk cache
- [ ] Prints summary: number of routes discovered, namespaces found, resource names
- [ ] Exits with code 0 on success
- [ ] Typecheck passes

---

### US-015: Implement `wpklx routes` command
**Description:** As a user, I want to see all discovered API routes so that I know what commands are available.

**Acceptance Criteria:**
- [ ] Loads schema from cache (or triggers discovery if no cache exists)
- [ ] Displays routes as a formatted table with columns: Resource, Action, HTTP Method, Path, Description
- [ ] Groups routes by resource
- [ ] Supports `--format json` to output as JSON instead of table
- [ ] Typecheck passes

---

### US-016: Implement `wpklx config` subcommands
**Description:** As a user, I want to manage my profiles from the CLI so that I don't have to manually edit YAML files.

**Acceptance Criteria:**
- [ ] `wpklx config ls` — lists all profile names, marks the default with `*`, marks the active one (if specified via `@name`)
- [ ] `wpklx config show` — shows the active profile's settings (masks password with `****`)
- [ ] `wpklx config show @name` — shows a specific profile's settings
- [ ] `wpklx config add <name>` — interactively prompts for host, username, application_password, and optional settings; writes to YAML file
- [ ] `wpklx config rm <name>` — removes a profile from the YAML file; refuses to remove the default profile unless another is set as default
- [ ] `wpklx config default <name>` — sets the default profile
- [ ] `wpklx config path` — prints the path to the config file currently in use
- [ ] Creates `~/.config/wpklx/config.yaml` if no config file exists when running `config add`
- [ ] Typecheck passes

---

### US-017: Implement `wpklx help` and resource-specific help
**Description:** As a user, I want contextual help so that I know how to use any command.

**Acceptance Criteria:**
- [ ] `wpklx help` or `wpklx --help` — shows global help: syntax, available built-in commands, global flags, example usage
- [ ] `wpklx <resource> help` or `wpklx <resource> --help` — shows help for a specific resource: available actions, accepted parameters for each action (name, type, required, description)
- [ ] Help text is rendered using `Bun.markdown.render()` with ANSI callbacks for terminal formatting (bold headings, styled tables)
- [ ] Typecheck passes

---

### US-018: Implement `wpklx version` command
**Description:** As a user, I want to check the installed CLI version.

**Acceptance Criteria:**
- [ ] `wpklx version` or `wpklx --version` or `wpklx -v` — prints `wpklx v{version}` from `package.json`
- [ ] Exits with code 0
- [ ] Typecheck passes

---

### US-019: Execute dynamic resource commands (CRUD)
**Description:** As a user, I want to run `wpklx post list`, `wpklx post get --id 42`, etc. and have them call the correct WordPress API endpoints.

**Acceptance Criteria:**
- [ ] `list` / `ls` — sends GET to the collection endpoint (e.g., `/wp/v2/posts`), passes query params from `--options`
- [ ] `get` / `show` — sends GET to the item endpoint (e.g., `/wp/v2/posts/42`), requires `--id` or positional ID
- [ ] `create` / `new` — sends POST to the collection endpoint with `--options` as JSON body
- [ ] `update` / `edit` — sends PUT/PATCH to the item endpoint with `--options` as JSON body, requires `--id` or positional ID
- [ ] `delete` / `rm` — sends DELETE to the item endpoint, requires `--id` or positional ID, supports `--force` for permanent deletion
- [ ] Passes `--per-page` and `--page` as query params for list actions
- [ ] Sends request through the HTTP client (with auth, retry, timeout)
- [ ] Pipes the API response to the output formatter
- [ ] Suggests similar resource names if the requested resource doesn't exist (fuzzy match)
- [ ] Typecheck passes

---

### US-020: Implement media upload command
**Description:** As a user, I want to upload files to WordPress media library from the CLI.

**Acceptance Criteria:**
- [ ] `wpklx media upload --file ./photo.jpg` uploads the file to `/wp/v2/media`
- [ ] Reads file from disk using Bun's file API
- [ ] Sends as `multipart/form-data` with correct `Content-Disposition` header
- [ ] Supports `--title` to set the media title
- [ ] Supports `--alt-text` to set alt text
- [ ] Shows upload progress if possible
- [ ] Returns the created media object through the output formatter
- [ ] Typecheck passes

---

### Phase 4 — Output & UX

---

### US-021: Build ANSI terminal renderer using Bun markdown
**Description:** As a developer, I need a markdown-to-ANSI renderer so that help text and structured output looks good in the terminal.

**Acceptance Criteria:**
- [ ] Uses `Bun.markdown.render()` with custom ANSI callbacks
- [ ] Renders headings as bold + underlined text
- [ ] Renders `**bold**` as ANSI bold
- [ ] Renders `*italic*` as ANSI italic
- [ ] Renders inline `code` with a dimmed/highlighted style
- [ ] Renders code blocks with language label
- [ ] Renders tables with box-drawing characters and column alignment
- [ ] Renders lists (ordered and unordered) with proper indentation
- [ ] Renders horizontal rules as terminal-width lines
- [ ] All ANSI output is disabled when `--no-color` flag is set or `NO_COLOR` env var is present
- [ ] Exported as a reusable helper from `src/cli/output.ts`
- [ ] Typecheck passes

---

### US-022: Implement table output formatter
**Description:** As a user, I want `list` results displayed as a formatted table so that I can scan data quickly.

**Acceptance Criteria:**
- [ ] Formats array responses as an aligned table with column headers
- [ ] Auto-detects columns from the first response object's keys
- [ ] `--fields id,title,status` limits which columns are shown
- [ ] Truncates long values to fit terminal width
- [ ] Uses the ANSI renderer for table styling (box-drawing characters, header highlighting)
- [ ] Falls back to simple pipe-delimited format when `--no-color` is set
- [ ] Typecheck passes

---

### US-023: Implement JSON and YAML output formatters
**Description:** As a user, I want to output results as JSON or YAML so that I can pipe them to other tools.

**Acceptance Criteria:**
- [ ] `--format json` outputs pretty-printed JSON to stdout
- [ ] `--format yaml` outputs YAML to stdout
- [ ] JSON output uses 2-space indentation
- [ ] `--fields` filters which keys are included in JSON/YAML output
- [ ] `--quiet` mode outputs only the `id` field(s), one per line
- [ ] Output goes to stdout (not stderr) so it can be piped
- [ ] Typecheck passes

---

### US-024: Implement verbose and quiet modes
**Description:** As a user, I want verbose mode for debugging and quiet mode for scripting.

**Acceptance Criteria:**
- [ ] `--verbose` logs to stderr: request method, URL, headers (masked auth), response status, timing, response headers
- [ ] `--verbose` shows retry attempts with delay info
- [ ] `--quiet` suppresses all output except the resource ID(s), one per line
- [ ] `--quiet` on `create` outputs just the new resource's ID
- [ ] `--quiet` on `list` outputs one ID per line
- [ ] `--quiet` on `delete` outputs nothing (just exit code)
- [ ] Verbose and quiet are mutually exclusive — if both are passed, verbose wins with a warning
- [ ] Typecheck passes

---

### US-025: Build logging helper with verbosity levels
**Description:** As a developer, I need a logger that respects verbosity settings so that debug info only appears when requested.

**Acceptance Criteria:**
- [ ] Logger in `src/helpers/logger.ts` with methods: `debug()`, `info()`, `warn()`, `error()`
- [ ] `debug()` only outputs when `--verbose` is enabled
- [ ] `info()` outputs normally (suppressed in `--quiet` mode)
- [ ] `warn()` always outputs to stderr
- [ ] `error()` always outputs to stderr
- [ ] All output respects `--no-color` flag
- [ ] Timestamps included in `--verbose` mode
- [ ] Typecheck passes

---

## Functional Requirements

- FR-1: The CLI binary is named `wpklx` and follows `wpklx [@profile] <resource> <action> [options]` syntax
- FR-2: Configuration resolves in order: CLI flags > `.env` > YAML profile > built-in defaults
- FR-3: The `.env` file supports: `WP_HOST`, `WP_USERNAME`, `WP_APPLICATION_PASSWORD`, `WP_API_PREFIX`, `WP_PER_PAGE`, `WP_TIMEOUT`, `WP_VERIFY_SSL`, `WP_OUTPUT_FORMAT`
- FR-4: YAML config supports multiple named profiles with `@name` switching syntax
- FR-5: API discovery fetches the `/wp-json` endpoint and parses all available routes, methods, and parameters
- FR-6: Schema is cached to `~/.config/wpklx/cache/` with configurable TTL (default 1 hour), plus in-memory cache per session
- FR-7: `wpklx discover` and `wpklx discover --force` bypass cache and force fresh discovery
- FR-8: HTTP client uses Basic Auth with WordPress application passwords
- FR-9: Transient failures (429, 5xx, network errors) retry with exponential backoff (1s, 2s, 4s)
- FR-10: Client errors (4xx except 429) are never retried
- FR-11: Actions map: `list`/`ls` -> GET collection, `get`/`show` -> GET item, `create`/`new` -> POST, `update`/`edit` -> PUT/PATCH, `delete`/`rm` -> DELETE
- FR-12: Positional IDs are supported: `wpklx post show 42` is equivalent to `wpklx post get --id 42`
- FR-13: Output supports `table`, `json`, `yaml` formats via `--format` flag
- FR-14: `--fields` filters which columns/keys appear in output
- FR-15: `--quiet` outputs only IDs; `--verbose` shows full request/response details
- FR-16: All errors produce non-zero exit codes: 0=success, 1=general, 2=config, 3=auth, 4=not found, 5=validation, 6=network/timeout
- FR-17: Error messages are human-readable and go to stderr
- FR-18: Help text and tables are rendered using `Bun.markdown.render()` with ANSI terminal callbacks
- FR-19: ANSI colors are disabled when `--no-color` is passed or `NO_COLOR` env var is set
- FR-20: Unknown resources suggest similar available resource names via fuzzy matching
- FR-21: Media upload sends files as `multipart/form-data` to `/wp/v2/media`

## Non-Goals

- No interactive/TUI mode (this is a non-interactive CLI)
- No WordPress XML-RPC support — REST API only
- No WP-CLI compatibility layer or migration tools
- No built-in plugin/theme management beyond what the REST API exposes
- No OAuth or JWT authentication — application passwords only
- No WebSocket or real-time subscriptions
- No auto-update mechanism for the CLI itself
- No shell completions in this initial version (can be added later)
- No unit/integration test framework setup in this PRD (separate effort)

## Technical Considerations

- **Runtime:** Bun (not Node.js) — use Bun APIs for file I/O, fetch, process management
- **Language:** TypeScript with strict mode
- **Dependencies:** Minimize external deps. Use `yaml` package for YAML parsing. Avoid frameworks like Commander/Yargs — build the parser to keep it lightweight and fully custom
- **Bun markdown:** `Bun.markdown.render()` with ANSI callbacks for terminal rendering — this is a Bun-specific API and may change (marked unstable)
- **File structure:** Follow the layout defined in readme: `src/cli/`, `src/api/`, `src/config/`, `src/helpers/`, `src/types/`
- **Cache directory:** `~/.config/wpklx/cache/` on macOS/Linux
- **Config file locations:** `./wpklx.config.yaml` (local) or `~/.config/wpklx/config.yaml` (global)
- **Singularization:** Simple rules for resource naming (strip trailing `s`, handle `ies` -> `y`, `sses` -> `ss`) — no need for a full NLP library
- **Fuzzy matching:** Levenshtein distance or similar for "did you mean?" suggestions on unknown resources

## Success Metrics

- User can configure a WordPress site via `.env` or YAML profile in under 2 minutes
- `wpklx discover` completes and caches schema in under 5 seconds on a standard WordPress install
- Subsequent commands load from cache in under 100ms
- `wpklx post ls` returns results in table format with correct columns
- All error scenarios produce a helpful message and correct exit code
- Profile switching via `@name` works anywhere in the command

## Open Questions

- Should `wpklx` support piping input for `create`/`update` (e.g., `echo '{"title":"Hello"}' | wpklx post create`)?
- Should table output auto-paginate for large result sets or always dump everything?
- What columns should be shown by default for each resource type, or should we always show all fields?
- Should `wpklx config add` support non-interactive mode via flags for scripting?
