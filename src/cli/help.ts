import { renderMarkdown } from "./output.ts";
import type { CommandMap } from "../api/schema.ts";

/**
 * Generates and prints global help text.
 */
export function showGlobalHelp(version: string): void {
  const help = `# wpklx v${version}

**KLX WordPress CLI** — dynamic, fault-tolerant CLI for the WordPress REST API.

## Usage

\`wpklx [@profile] <resource> <action> [options]\`

## Built-in Commands

- \`wpklx login\` — Interactive WordPress site setup
- \`wpklx version\` — Show CLI version
- \`wpklx discover\` — Discover API routes from WordPress site
- \`wpklx routes\` — List available API routes
- \`wpklx serialize\` — Convert HTML to WordPress block HTML
- \`wpklx markdown\` — Convert Markdown to WordPress block HTML
- \`wpklx config ls\` — List profiles
- \`wpklx config show\` — Show profile settings
- \`wpklx config path\` — Show config file path
- \`wpklx config add <name>\` — Add a new profile
- \`wpklx config rm <name>\` — Remove a profile
- \`wpklx config default <name>\` — Set default profile
- \`wpklx help\` — Show this help
- \`wpklx <resource> help\` — Show help for a resource

## Positional ID

\`wpklx <resource> <action> <id>\` — Pass the ID directly without \`--id\`:

\`wpklx post show 42\`, \`wpklx post edit 42 --title "New"\`, \`wpklx post rm 42\`

## Global Flags

- \`--format <table|json|yaml>\` — Output format (default: table)
- \`--fields <field1,field2|all>\` — Limit output fields, or \`all\` for every column
- \`--per-page <n>\` — Results per page (default: 20)
- \`--page <n>\` — Page number
- \`--quiet\` — Minimal output (IDs only)
- \`--verbose\` — Debug output
- \`--no-color\` — Disable ANSI colors
- \`--env <path>\` — Custom .env file path

Flags accept both \`--flag value\` and \`--flag=value\` syntax.

## Content Transformation (create/update)

- \`--serialize\` — Convert HTML content to WordPress block HTML before sending
- \`--markdown\` — Convert Markdown content to block HTML before sending
- \`--no-h1\` — Strip the first H1 element (use with \`--serialize\` or \`--markdown\`)

Example: \`wpklx post create --title "Hello" --content "<p>Hi</p>" --serialize\`
Example: \`wpklx post edit 42 --content "# Updated" --markdown --no-h1\`

## Serialize & Markdown Commands

- \`--file <path>\` — Read input from file (or \`-\` for stdin)
- \`--output <path>\` — Write output to file
- \`--no-h1\` — Strip the first H1 element

## Stdin & Pipes

- \`--flag -\` — Read stdin into a specific flag
- Bare pipe auto-maps to \`--content\` for posts/pages or \`--file\` for media

## Media Upload

\`wpklx media upload --file <path>\` — Upload a file to the WordPress media library.

- \`--file <path>\` — Path to the file to upload *(required)*
- \`--title <text>\` — Set the media title
- \`--alt-text <text>\` — Set the alt text for images
- \`--mime-type <type>\` — Override the MIME type (auto-detected from extension)

Supports stdin: \`cat photo.jpg | wpklx media upload --file -\`
When piping binary data, use \`--title\` or \`--filename\` to set the name.

Supported formats: jpg, png, gif, webp, svg, pdf, mp4, mp3, wav.

## Action Shortcuts

\`ls\` → list, \`show\` → get, \`new\` → create, \`edit\` → update, \`rm\` → delete

## Namespace Prefix

\`wpklx <namespace>:<resource> <action>\` — Access plugin routes (e.g. \`wpml:post list\`)

## Examples

\`\`\`
wpklx post list --status draft
wpklx post show 42 --fields=all
wpklx post edit 42 --title="Updated" --status=publish
wpklx @staging post create --title "Hello" --status publish
wpklx media upload --file ./photo.jpg
cat photo.jpg | wpklx media upload --file -
echo "# Hello" | wpklx markdown
wpklx serialize --file page.html --output page.blocks.html
wpklx wpml:post list --format json
\`\`\`
`;

  console.log(renderMarkdown(help));
}

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
  lines.push(`## Available Actions\n`);

  for (const [action, meta] of Object.entries(resourceCommands)) {
    lines.push(`### ${action} (${meta.method})\n`);
    lines.push(`Path: \`${meta.path}\`\n`);

    if (meta.params.length > 0) {
      lines.push("**Parameters:**\n");
      for (const param of meta.params) {
        const required = param.required ? " *(required)*" : "";
        const type = param.type ? ` \`${param.type}\`` : "";
        const desc = param.description ? ` — ${param.description}` : "";
        const enumVals =
          param.enum ? ` (${param.enum.join(", ")})` : "";
        lines.push(`- \`--${param.name}\`${type}${required}${desc}${enumVals}`);
      }
      lines.push("");
    }

    // Show content transformation flags for create/update actions
    if (action === "create" || action === "update") {
      lines.push("**Content Transformation:**\n");
      lines.push(`- \`--serialize\` — Convert HTML content to WordPress block HTML`);
      lines.push(`- \`--markdown\` — Convert Markdown content to block HTML`);
      lines.push(`- \`--no-h1\` — Strip the first H1 element (use with \`--serialize\` or \`--markdown\`)`);
      lines.push("");
    }
  }

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
