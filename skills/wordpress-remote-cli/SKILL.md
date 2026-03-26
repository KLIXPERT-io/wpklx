---
name: wordpress-remote-cli
description: Manage WordPress sites via the wpklx CLI — create/update/delete posts, pages, media, users, comments, categories, tags, and any plugin-provided resource. Use when the user needs to interact with a WordPress site, manage content, upload media, convert Markdown/HTML to block format, or automate WordPress workflows from the command line.
allowed-tools: Bash(wpklx:*)
---

# WordPress Remote CLI (wpklx)

wpklx is a dynamic CLI for the WordPress REST API. It discovers routes at runtime from `/wp-json` — any resource registered by WordPress core or plugins becomes a CLI command automatically.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/KLIXPERT-io/wpklx/main/install.sh | bash
```

## Quick start

```bash
wpklx login                              # Interactive setup (host, username, app password)
wpklx discover                           # Fetch and cache API schema
wpklx routes                             # List all available commands
wpklx post list                          # List published posts
wpklx post get 42                        # Get post by ID
wpklx post create --title "Hello World"  # Create a new post
```

## Syntax

```
wpklx [--profile <name> | @name] <resource> <action> [id] [--option value] [flags]
```

- `--profile <name>` / `-p <name>` / `@name` — optional, selects a named site profile (e.g., `--profile staging`, `-p staging`, `@staging`). All three forms are equivalent.
- `<resource>` — the WordPress resource (post, page, media, user, category, tag, comment, or any plugin resource)
- `<action>` — CRUD action or shortcut
- `[id]` — positional ID (alternative to `--id <n>`)
- `[--option value]` — resource-specific parameters from the API schema

## Actions and shortcuts

| Action   | Shortcut | HTTP    | Description        |
|----------|----------|---------|--------------------|
| `list`   | `ls`     | GET     | List items         |
| `get`    | `show`   | GET     | Get single item    |
| `create` | `new`    | POST    | Create item        |
| `update` | `edit`   | PUT/PATCH | Update item      |
| `delete` | `rm`     | DELETE  | Delete item        |

## Built-in commands

```bash
wpklx login                     # Interactive site setup wizard
wpklx discover                  # Force-refresh API schema cache
wpklx routes                    # List all discovered routes
wpklx help                      # Global help
wpklx <resource> help           # Resource-specific help with parameters
wpklx version                   # Print version
wpklx serialize                 # Convert HTML to WordPress block HTML (standalone)
wpklx markdown                  # Convert Markdown to WordPress block HTML (standalone)
```

### Profile management

```bash
wpklx config ls                 # List all profiles
wpklx config show               # Show active profile details
wpklx config show @staging      # Show specific profile
wpklx config add <name>         # Add new profile interactively
wpklx config rm <name>          # Remove a profile
wpklx config default <name>     # Set the default profile
wpklx config path               # Print config file path in use
```

## Global flags

### Profile selection

```
--profile <name>, -p <name>  Use a named profile from wpklx.config.yaml
@<name>                      Shorthand for --profile (e.g., @staging)
```

If omitted, the default profile is used (set via `wpklx config default`).
Note: `@name` and `--profile` cannot be used together — use one or the other.

### Output flags

```
--format <table|json|yaml>   Output format (default: table). Use json for scripting, yaml for readability, table for humans.
--fields <list|all>          Comma-separated fields to include in output. Use "all" to show every field returned by the API.
--quiet                      Suppress all output except resource IDs. Useful for scripting: wpklx post list --quiet | xargs -I{} wpklx post rm {}
--verbose                    Print debug information including HTTP requests, timing, and config resolution.
--no-color                   Disable ANSI color codes in output.
```

### Pagination flags

```
--per-page <n>               Number of results per page (default: 20, max depends on site)
--page <n>                   Page number to retrieve (default: 1)
```

### Content transformation flags (for create/update actions)

```
--serialize                  Convert --content value from raw HTML to WordPress block HTML before sending. Requires --content.
--markdown                   Convert --content value from Markdown to WordPress block HTML before sending. Requires --content.
--no-h1                      Strip the first <h1> from converted content. Use with --serialize or --markdown.
```

Note: `--serialize` and `--markdown` are mutually exclusive.

### Other flags

```
--env <path>                 Load a custom .env file instead of the default .env in cwd.
--help, -h                   Show help
--version, -v                Show version
```

Flags accept both `--flag value` and `--flag=value` syntax.

## Namespace prefix

When plugins register resources with the same name, use a namespace prefix:

```bash
wpklx wpml:post list               # WPML plugin's post resource
wpklx woocommerce:product list     # WooCommerce products
wpklx myplugin:settings get        # Custom plugin settings
```

Without a prefix, `wp/v2` core routes are prioritized.

## Stdin piping

### Explicit mapping with `--flag -`

```bash
echo "Hello World" | wpklx post create --content - --title "My Post"
cat draft.md | wpklx page update 12 --content -
cat photo.jpg | wpklx media upload --file - --title "Hero"
```

### Bare pipe (auto-mapped)

When no `--flag -` is specified, stdin maps to a sensible default:

| Resource        | Default parameter |
|-----------------|-------------------|
| post, page      | `content`         |
| comment         | `content`         |
| category, tag   | `description`     |
| media           | `file`            |
| *other*         | `content`         |

```bash
echo "Post body" | wpklx post create --title "Auto-mapped"
cat article.md | wpklx post create --title "From Markdown" --markdown
```

Stdin is only accepted for write actions (create, update). If the default parameter is already provided via CLI args, bare-pipe stdin is ignored.

## Media uploads

```bash
wpklx media upload --file ./photo.jpg --title "Hero Image"
wpklx media upload --file ./doc.pdf --title "Report"
cat image.png | wpklx media upload --file - --title "Piped" --mime-type image/png
curl -s https://example.com/img.jpg | wpklx media upload --file - --title "Downloaded"
```

MIME type is auto-detected from the file extension. Use `--mime-type` to override when piping binary data.

## Content transformation

### Inline (with create/update)

```bash
# Convert Markdown content to WordPress blocks on the fly
wpklx post create --title "My Post" --content "# Hello\n\nParagraph" --markdown

# Convert HTML to blocks
wpklx post update 42 --content "<h2>Updated</h2><p>New content</p>" --serialize

# Strip the first H1 before converting
cat article.md | wpklx post create --title "Article" --markdown --no-h1
```

### Standalone commands

```bash
# Convert an HTML file to block HTML
wpklx serialize --file article.html --output article.blocks.html
cat page.html | wpklx serialize --no-h1 > blocks.html

# Convert a Markdown file to block HTML
wpklx markdown --file draft.md --output draft.blocks.html
cat README.md | wpklx markdown > readme.blocks.html
```

## Output formats

### Table (default)

Auto-selects essential columns (id, title, slug, status, date). Use `--fields` to customize:

```bash
wpklx post list                                  # Default columns
wpklx post list --fields=all                     # Every column
wpklx post list --fields=id,title,status,date    # Specific columns
```

### JSON

```bash
wpklx post list --format json
wpklx post get 42 --format json
```

### YAML

```bash
wpklx post list --format yaml
```

### Quiet (IDs only)

```bash
wpklx post list --quiet
# 1
# 42
# 103
```

## Profiles

Switch between WordPress sites using `--profile`, `-p`, or `@name`:

```bash
# All three forms are equivalent:
wpklx --profile production post list
wpklx -p production post list
wpklx @production post list

# --profile / -p can appear anywhere in the command:
wpklx post list --profile staging --format json
wpklx post create -p staging --title "Test"

# More examples:
wpklx @local page ls --status draft
wpklx post list                          # Uses the default profile
```

Profiles are defined in `wpklx.config.yaml` (local) or `~/.config/wpklx/config.yaml` (global).

Config resolution order: CLI flags > .env file > active YAML profile > built-in defaults.

Environment variables: `WP_HOST`, `WP_USERNAME`, `WP_APPLICATION_PASSWORD`, `WP_API_PREFIX`, `WP_PER_PAGE`, `WP_TIMEOUT`, `WP_VERIFY_SSL`, `WP_OUTPUT_FORMAT`.

## Error handling

wpklx retries transient failures (network errors, 429, 502, 503, 504) with exponential backoff. It does not retry auth or validation errors.

When a resource or action is not found, wpklx suggests similar commands using fuzzy matching.

All error messages include what went wrong, why, and remediation steps. For example, authentication errors suggest checking credentials and regenerating application passwords, network errors differentiate between timeout/DNS/SSL/connection-refused with targeted fixes, and validation errors list each invalid field with its constraint.

### Exit codes

| Code | Meaning              | Common causes and fixes |
|------|----------------------|------------------------|
| 0    | Success              | — |
| 1    | General error        | Unexpected API response |
| 2    | Configuration error  | Missing profile, bad YAML, missing required fields. Fix: `wpklx config show` or `wpklx login` |
| 3    | Authentication error | Wrong credentials, expired application password. Fix: regenerate at WP Admin → Users → Profile → Application Passwords |
| 4    | Resource not found   | Unknown resource or missing item. Fix: `wpklx routes` to check available resources |
| 5    | Validation error     | Missing required fields, invalid values. Fix: `wpklx <resource> help` to see accepted parameters |
| 6    | Network/timeout      | Timeout, DNS failure, SSL error, connection refused. Fix: check URL with `wpklx config show` |

## Best practices

- Always run `wpklx discover` after installing or removing WordPress plugins to refresh the route cache.
- Use `wpklx <resource> help` to see all accepted parameters for a resource before constructing commands.
- Use `--format json` when you need to parse output or chain commands.
- Use `--quiet` to get IDs for scripting (e.g., pipe into xargs).
- Use `--verbose` to debug authentication or network issues.
- Use `--fields=all` to inspect the full data shape before selecting specific fields.
- Prefer positional IDs (`wpklx post get 42`) over `--id 42` for brevity.
- Use `--serialize` or `--markdown` with `--no-h1` when the first heading duplicates the post title.

## Complex examples

### Bulk publish all draft posts

```bash
wpklx post list --status draft --quiet | xargs -I {} wpklx post update {} --status publish
```

### Create a post from a Markdown file with block serialization

```bash
cat article.md | wpklx post create \
  --title "Complete Guide to TypeScript" \
  --status draft \
  --categories 5,12 \
  --tags 8,15,23 \
  --markdown \
  --no-h1
```

### Upload an image and set it as a post's featured image

```bash
MEDIA_ID=$(wpklx media upload --file ./hero.jpg --title "Hero Image" --quiet)
wpklx post update 42 --featured_media "$MEDIA_ID"
```

### Mirror posts from production to staging

```bash
wpklx --profile production post list --format json --fields=title,content,status,categories \
  | jq -c '.[]' \
  | while read -r post; do
      title=$(echo "$post" | jq -r '.title.rendered // .title')
      content=$(echo "$post" | jq -r '.content.rendered // .content')
      echo "$content" | wpklx -p staging post create --title "$title" --content - --status draft
    done
```

### Export all pages to individual JSON files

```bash
for id in $(wpklx page list --quiet --per-page 100); do
  wpklx page get "$id" --format json > "page-${id}.json"
done
```

### Batch delete all trashed posts

```bash
wpklx post list --status trash --quiet | xargs -I {} wpklx post delete {} --force
```

### Create a page from an HTML file, serialized to blocks

```bash
wpklx page create \
  --title "About Us" \
  --content "$(cat about.html)" \
  --serialize \
  --no-h1 \
  --status publish
```

### Find posts by a specific author and re-assign them

```bash
wpklx post list --author 3 --quiet | xargs -I {} wpklx post update {} --author 7
```

### List all WooCommerce products on sale with specific fields

```bash
wpklx woocommerce:product list --on_sale true --fields=id,name,price,sale_price --per-page 50
```

### Multi-site content audit: compare post counts across profiles

```bash
echo "Production: $(wpklx -p production post list --quiet --per-page 1 2>/dev/null | wc -l) posts"
echo "Staging:    $(wpklx -p staging post list --quiet --per-page 1 2>/dev/null | wc -l) posts"
```

### Upload multiple images from a directory

```bash
for img in ./images/*.jpg; do
  wpklx media upload --file "$img" --title "$(basename "$img" .jpg)" --quiet
done
```

### Create a post with inline Markdown content

```bash
wpklx post create \
  --title "Release Notes v2.0" \
  --content "## What's New

- **Dark mode** — fully themed UI
- **Performance** — 3x faster page loads
- **API v2** — new endpoints for integrations

## Breaking Changes

The \`/v1/legacy\` endpoint has been removed. Migrate to \`/v2/modern\` before upgrading." \
  --markdown \
  --status draft
```

### Chain discovery with route inspection for a new site

```bash
wpklx --profile newsite discover && wpklx --profile newsite routes
```

### Conditional update: only publish if post exists

```bash
if wpklx post get 42 --quiet 2>/dev/null; then
  wpklx post update 42 --status publish
else
  echo "Post 42 not found"
fi
```
