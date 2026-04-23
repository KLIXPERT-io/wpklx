import { renderMarkdown } from "./output.ts";
import type { CommandMap } from "../api/schema.ts";

/**
 * Generates and prints global help text.
 */
export function showGlobalHelp(version: string): void {
  const help = `# wpklx v${version}

**KLX WordPress CLI** — a dynamic CLI for the WordPress REST API.
Discovers available resources and actions from your WordPress site automatically.

## Usage

\`wpklx [--profile <name> | @name] <resource> <action> [<id>] [options]\`

## Authentication

Run \`wpklx login\` to set up a site interactively. The CLI uses WordPress
Application Passwords for authentication (WP Admin → Users → Profile).

## Commands

- \`wpklx login\` — Set up a WordPress site interactively (creates a profile)
- \`wpklx discover\` — Fetch and display the full API schema from the site
- \`wpklx routes\` — List all available resources and their actions
- \`wpklx config ls\` — List all configured profiles
- \`wpklx config show\` — Show resolved settings for the active profile
- \`wpklx config path\` — Print the path to the config file in use
- \`wpklx config add <name>\` — Add a new profile interactively
- \`wpklx config rm <name>\` — Remove a profile (cannot remove the current default)
- \`wpklx config default <name>\` — Set the default profile used when no @profile is given
- \`wpklx serialize\` — Convert raw HTML to WordPress block-editor HTML
- \`wpklx markdown\` — Convert Markdown to WordPress block-editor HTML
- \`wpklx <resource> help\` — Show all actions and parameters for a specific resource
- \`wpklx help\` — Show this help

## Resource Commands

Resources (post, page, user, category, tag, media, comment, ...) and their
actions (list, get, create, update, delete) are discovered at runtime from
the WordPress REST API. Run \`wpklx routes\` to see what your site exposes.

**Action shortcuts:**
\`ls\` → list, \`show\` → get, \`new\` → create, \`edit\` → update, \`rm\` → delete

**Positional ID** — pass the item ID as the third argument instead of --id:

- \`wpklx post show 42\` — Equivalent to: \`wpklx post get --id 42\`
- \`wpklx post edit 42 --title "X"\` — Update post 42
- \`wpklx post rm 42\` — Delete post 42

**Namespace prefix** — access plugin routes with namespace:resource syntax:

- \`wpklx wpml:post list\` — List posts from the WPML plugin namespace

## Profile Selection

- \`--profile <name>\`, \`-p <name>\` — Use a named profile from wpklx.config.yaml
- \`@<name>\` — Shorthand for --profile (e.g. \`@staging\`)

If omitted, the default profile is used (set via \`wpklx config default\`).
Profiles are stored in wpklx.config.yaml (local) or ~/.config/wpklx/config.yaml (global).

## Output Flags

- \`--format <table|json|yaml>\` — Output format (default: table). Use json for scripting, yaml for readability, table for humans.
- \`--fields <field1,field2|all>\` — Comma-separated list of fields to include in output. Use \`--fields all\` to show every field returned by the API. Example: \`--fields id,title,status,date\`
- \`--quiet\` — Suppress all output except resource IDs. Useful for scripting: \`wpklx post list --quiet | xargs -I{} wpklx post rm {}\`
- \`--verbose\` — Print debug information including HTTP requests, timing, and config resolution.
- \`--no-color\` — Disable ANSI color codes in output.

Flags accept both \`--flag value\` and \`--flag=value\` syntax.

## Pagination Flags

- \`--per-page <n>\` — Number of results per page (default: 20, max depends on site)
- \`--page <n>\` — Page number to retrieve (default: 1)

## Content Transformation Flags (for create/update actions)

- \`--serialize\` — Convert the --content value from raw HTML to WordPress block HTML before sending to the API. Requires --content to be set.
- \`--markdown\` — Convert the --content value from Markdown to WordPress block HTML before sending. Requires --content to be set.
- \`--no-h1\` — Strip the first <h1> from converted content. Useful when the post title duplicates the first heading in the content.

Note: --serialize and --markdown are mutually exclusive.

Example — create a post from Markdown:
\`wpklx post new --title "Guide" --content "## Intro\\nHello world" --markdown --status publish\`

Example — update post content from an HTML file:
\`wpklx post edit 42 --content "$(cat page.html)" --serialize --no-h1\`

## Stdin & Pipes

Any flag can read its value from stdin using \`-\` as the value:

\`echo "Hello world" | wpklx post new --title "Piped" --content -\`

When piping without an explicit flag, stdin auto-maps to --content for posts/pages
and --file for media uploads:

\`echo "# Hello" | wpklx post new --title "From stdin"\`
\`cat photo.jpg | wpklx media upload --title "Photo"\`

## Media Upload

\`wpklx media upload --file <path>\` — Upload a local file to the WordPress media library.

- \`--file <path>\` — Path to the file to upload *(required)*. Use \`--file -\` for stdin.
- \`--title <text>\` — Set the media title (default: filename)
- \`--alt-text <text>\` — Set alt text for images (important for accessibility/SEO)
- \`--mime-type <type>\` — Override auto-detected MIME type

Supported formats: jpg, png, gif, webp, svg, pdf, mp4, mp3, wav.

Example — upload and set metadata:
\`wpklx media upload --file ./hero.jpg --title "Hero Banner" --alt-text "Homepage hero image"\`

Example — pipe from another command:
\`curl -s https://example.com/image.png | wpklx media upload --file - --title "Downloaded"\`

## Serialize & Markdown Standalone Commands

Convert files without touching the WordPress API.

- \`--file <path>\` — Input file path (or \`-\` for stdin)
- \`--output <path>\` — Write result to file instead of stdout
- \`--no-h1\` — Strip the first H1 heading

Example: \`wpklx serialize --file page.html --output blocks.html\`
Example: \`cat README.md | wpklx markdown --no-h1\`
Example: \`wpklx markdown --file article.md --output article.blocks.html\`

## Config File

- Local: \`./wpklx.config.yaml\` (project-specific, takes priority)
- Global: \`~/.config/wpklx/config.yaml\` (shared across projects)

Resolution order: CLI flags > environment variables > YAML profile > built-in defaults

Environment variables: WP_HOST, WP_USERNAME, WP_APPLICATION_PASSWORD,
WP_API_PREFIX, WP_PER_PAGE, WP_TIMEOUT, WP_VERIFY_SSL, WP_OUTPUT_FORMAT

## Safe Mode

- \`--revision\` — Save a local snapshot before any \`update\` or \`delete\`. Your safety net for destructive operations.

Snapshots are stored in \`~/.config/wpklx/revisions/\` (up to 10 per resource, oldest auto-pruned).

**Restore workflow:**

- \`wpklx <resource> revisions <id>\` — List saved snapshots for a resource
- \`wpklx <resource> restore <id>\` — Restore the most recent snapshot
- \`wpklx <resource> restore <id> --rev N\` — Restore a specific snapshot (1=latest)

**Examples:**

\`wpklx post edit 42 --title "New Title" --revision\` — Update with snapshot
\`wpklx post rm 42 --revision\` — Delete with snapshot
\`wpklx post revisions 42\` — List snapshots for post 42
\`wpklx post restore 42\` — Restore the latest snapshot
\`wpklx post restore 42 --rev 2\` — Restore the second-latest snapshot

Note: only fields accepted by the update endpoint are restored (smart field filtering).

## Edit Workflow (pull / push / diff)

Edit a resource locally like a file, preview the changes, then push only what changed.
Uses Google's diff-match-patch for readable text diffs.

- \`wpklx <resource> pull <id>\` — Download to \`<resource>-<id>.json\` + a hidden baseline sidecar.
- \`wpklx <resource> pull <id> --file <path>\` — Custom output path.
- \`wpklx <resource> diff --file <path>\` — Show local edits (vs baseline).
- \`wpklx <resource> diff --file <path> --server\` — Also compare baseline to current server state and surface conflicts.
- \`wpklx <resource> push --file <path>\` — Send only the changed fields. Detects conflicts against the server.
- \`wpklx <resource> push --file <path> --dry-run\` — Preview diff without sending.
- \`wpklx <resource> push --file <path> --force\` — Skip conflict check and confirm prompt.
- \`wpklx <resource> push --file <path> --yes\` — Skip confirm prompt only.

**Example:**

\`\`\`
wpklx post pull 42                        # writes post-42.json and .post-42.baseline.json
# edit post-42.json in your editor
wpklx post diff --file post-42.json       # preview changes
wpklx post push --file post-42.json       # confirm and push
\`\`\`

Works for any resource that exposes both get and update (post, page, and most others).

Conflict detection: if a field was edited locally AND on the server since the pull, push aborts unless \`--force\` is passed.

Tip: add \`.*.baseline.json\` to .gitignore if you check in the working files.

## Environment Flags

- \`--env <path>\` — Load a custom .env file instead of the default .env in cwd.

## Exit Codes

- **0** — Success
- **1** — General error
- **2** — Configuration error (missing profile, bad YAML, missing required fields)
- **3** — Authentication error (wrong credentials, expired application password)
- **4** — Not found (unknown resource or missing item — run \`wpklx routes\` to check)
- **5** — Validation error (missing required fields, invalid values)
- **6** — Network error (timeout, DNS failure, SSL error)

## Quick Start

\`\`\`
wpklx login                                    Set up your first site
wpklx routes                                   See what resources are available
wpklx post list                                List recent posts
wpklx post show 1 --fields all                 View all fields of post 1
wpklx post new --title "Hello" --status draft   Create a draft post
wpklx --profile staging post list --format json List posts on staging as JSON
wpklx -p staging post list                      Same as above, short form
wpklx @staging post list                        Same as above, @ shorthand
\`\`\`
`;

  console.log(renderMarkdown(help));
}

/** Descriptions for common CRUD actions */
const ACTION_DESCRIPTIONS: Record<string, string> = {
  list: "Retrieve a paginated list of items. Supports filtering, search, and sorting.",
  get: "Retrieve a single item by ID. Returns all available fields.",
  create: "Create a new item. Required fields depend on the resource type.",
  update: "Update an existing item by ID. Only changed fields need to be sent.",
  delete: "Delete an item by ID. Some resources support --force to bypass trash.",
};

/**
 * Generates and prints resource-specific help.
 */
export function showResourceHelp(
  resource: string,
  commands: CommandMap,
): void {
  const resourceCommands = commands[resource];
  if (!resourceCommands) {
    console.log(`Unknown resource: ${resource}`);
    suggestSimilar(resource, Object.keys(commands));
    return;
  }

  const lines: string[] = [`# ${resource}\n`];
  lines.push(`Run \`wpklx routes\` to see all available resources.\n`);
  lines.push(`## Available Actions\n`);

  for (const [action, meta] of Object.entries(resourceCommands)) {
    const actionDesc = ACTION_DESCRIPTIONS[action] ?? "";
    lines.push(`### ${action} (${meta.method}) — ${actionDesc}\n`);
    lines.push(`Path: \`${meta.path}\`\n`);

    if (meta.params.length > 0) {
      // Separate required and optional params
      const requiredParams = meta.params.filter((p) => p.required);
      const optionalParams = meta.params.filter((p) => !p.required);

      if (requiredParams.length > 0) {
        lines.push("**Required Parameters:**\n");
        for (const param of requiredParams) {
          const type = param.type ? ` \`${param.type}\`` : "";
          const desc = param.description ? ` — ${param.description}` : "";
          const enumVals =
            param.enum ? ` Values: ${param.enum.join(", ")}` : "";
          lines.push(`- \`--${param.name}\`${type}${desc}${enumVals}`);
        }
        lines.push("");
      }

      if (optionalParams.length > 0) {
        lines.push("**Optional Parameters:**\n");
        for (const param of optionalParams) {
          const type = param.type ? ` \`${param.type}\`` : "";
          const desc = param.description ? ` — ${param.description}` : "";
          const enumVals =
            param.enum ? ` Values: ${param.enum.join(", ")}` : "";
          lines.push(`- \`--${param.name}\`${type}${desc}${enumVals}`);
        }
        lines.push("");
      }
    }

    // Show content transformation flags for create/update actions
    if (action === "create" || action === "update") {
      lines.push("**Content Transformation:**\n");
      lines.push(`- \`--serialize\` — Convert raw HTML content to WordPress block HTML before sending. Requires --content.`);
      lines.push(`- \`--markdown\` — Convert Markdown content to WordPress block HTML before sending. Requires --content.`);
      lines.push(`- \`--no-h1\` — Strip the first H1 heading from converted content. Use with --serialize or --markdown.`);
      lines.push(`- Note: --serialize and --markdown are mutually exclusive.\n`);
    }

    // Show examples for each action
    if (action === "list") {
      lines.push("**Examples:**\n");
      lines.push(`- \`wpklx ${resource} list\``);
      lines.push(`- \`wpklx ${resource} list --format json\``);
      lines.push(`- \`wpklx ${resource} list --per-page 50 --page 2\``);
      lines.push(`- \`wpklx ${resource} ls --fields id,title,status\``);
      lines.push("");
    } else if (action === "get") {
      lines.push("**Examples:**\n");
      lines.push(`- \`wpklx ${resource} get 42\``);
      lines.push(`- \`wpklx ${resource} show 42 --fields all\``);
      lines.push(`- \`wpklx ${resource} show 42 --format json\``);
      lines.push("");
    } else if (action === "create") {
      lines.push("**Examples:**\n");
      lines.push(`- \`wpklx ${resource} create --title "New Item" --status draft\``);
      lines.push(`- \`wpklx ${resource} new --title "Hello" --content "## Intro" --markdown --status publish\``);
      lines.push("");
    } else if (action === "update") {
      lines.push("**Examples:**\n");
      lines.push(`- \`wpklx ${resource} update 42 --title "Updated Title"\``);
      lines.push(`- \`wpklx ${resource} edit 42 --status publish\``);
      lines.push(`- \`wpklx ${resource} edit 42 --content "$(cat file.html)" --serialize\``);
      lines.push(`- \`wpklx ${resource} edit 42 --title "Risky change" --revision\` — save a snapshot first`);
      lines.push("");
    } else if (action === "delete") {
      lines.push("**Examples:**\n");
      lines.push(`- \`wpklx ${resource} delete 42\``);
      lines.push(`- \`wpklx ${resource} rm 42 --force true\``);
      lines.push(`- \`wpklx ${resource} rm 42 --revision\` — save a snapshot before deleting`);
      lines.push("");
    }
  }

  // Common workflows section
  lines.push(`## Common Workflows\n`);
  lines.push(`List all items as JSON: \`wpklx ${resource} list --format json\``);
  lines.push(`Get full details: \`wpklx ${resource} show <id> --fields all\``);
  lines.push(`Pipe IDs for batch operations: \`wpklx ${resource} list --quiet | xargs -I{} wpklx ${resource} rm {}\``);
  lines.push(`Use a different profile: \`wpklx --profile staging ${resource} list\` or \`wpklx @staging ${resource} list\``);
  lines.push("");

  console.log(renderMarkdown(lines.join("\n")));
}

function suggestSimilar(input: string, candidates: string[]): void {
  const similar = candidates
    .map((c) => ({ name: c, distance: levenshtein(input, c) }))
    .filter((c) => c.distance <= 3)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  if (similar.length > 0) {
    console.log(`Did you mean: ${similar.map((s) => s.name).join(", ")}?`);
  }
  console.log(`Run \`wpklx routes\` to see available commands.`);
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  return matrix[a.length]![b.length]!;
}

export { levenshtein, suggestSimilar };
