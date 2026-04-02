# KLX WordPress CLI

A dynamic, fault-tolerant command-line interface for the WordPress REST API, built with Bun and TypeScript.

KLX discovers available routes from your WordPress site's REST API at runtime and generates CLI commands automatically — no hardcoded endpoints, no manual updates when plugins add new routes.

Whether you manage a single blog or dozens of client sites, KLX gives you a fast, scriptable WordPress CLI (wp cli alternative) that works with any WordPress installation — including headless setups, multisite networks, and sites extended by WooCommerce, WPML, ACF, or any plugin that registers REST API routes. No SSH access or server-side tooling required — KLX talks directly to the WordPress REST API over HTTP.

## Features

- **Auto-discovery** — fetches your site's REST API schema and generates commands on the fly; no hardcoded endpoints
- **Multi-site profiles** — manage unlimited WordPress sites via YAML profiles and switch with `@name` syntax
- **Full CRUD** — list, get, create, update, and delete any resource with intuitive action shortcuts (`ls`, `show`, `new`, `edit`, `rm`)
- **Plugin-aware** — automatically picks up routes registered by WooCommerce, WPML, ACF, Yoast, Gravity Forms, and any other plugin
- **Namespace prefixes** — disambiguate overlapping resource names with `wpml:post`, `woocommerce:product`, etc.
- **Stdin piping** — pipe content from files, other commands, or markdown into create/update actions
- **Flexible output** — table, JSON, or YAML output with field filtering (`--fields=id,title,status`) and quiet mode (`--quiet`)
- **Fault-tolerant** — retries with exponential backoff, clear auth error messages, fuzzy command suggestions for typos
- **Interactive login** — `wpklx login` walks you through connecting to a site in seconds
- **Cross-platform** — pre-built binaries for Linux x64, macOS Intel, macOS Apple Silicon, and Windows x64
- **No server access needed** — works entirely over the REST API using WordPress application passwords
- **Scriptable** — clean exit codes, `--quiet` mode, and piping support make it ideal for shell scripts and CI/CD pipelines

## Use Cases

### Content Management & Publishing

Bulk-manage posts, pages, and custom post types from the terminal. Draft content in markdown, pipe it into KLX, and publish across multiple sites without ever opening the WordPress admin.

```bash
# Create a post from a markdown file
cat article.md | wpklx post create --title "Weekly Roundup" --status draft

# Publish all draft posts on staging
wpklx @staging post ls --status draft --quiet | xargs -I {} wpklx @staging post update {} --status publish
```

### Multi-Site Operations

Agencies and freelancers managing multiple client sites can switch between profiles in a single terminal session — no browser tabs, no re-logging in.

```bash
# Check for pending comments across sites
wpklx @client-a comment ls --status hold
wpklx @client-b comment ls --status hold

# Deploy the same page to staging and production
cat landing.html | wpklx @staging page create --title "Promo" --status publish
cat landing.html | wpklx @production page create --title "Promo" --status draft
```

### CI/CD & Automation

Integrate WordPress content updates into your deployment pipeline. Clean exit codes and `--quiet` mode make KLX ideal for shell scripts, GitHub Actions, and cron jobs.

```bash
# Sync content as part of a deploy script
wpklx post create --title "$RELEASE_TAG" --content - < changelog.md --status publish

# Verify the site is reachable after deploy
wpklx @production post ls --per-page 1 --quiet && echo "Site OK"
```

### WooCommerce & Plugin Management

Any plugin that registers REST API routes is automatically available — manage WooCommerce products, Gravity Forms entries, WPML translations, and more without plugin-specific CLIs.

```bash
# List WooCommerce products
wpklx woocommerce:product ls

# Export all form entries as JSON
wpklx gravityforms:entry ls --format json > entries.json
```

### Content Migration

Move content between WordPress sites by exporting from one profile and importing to another — all from the command line.

```bash
# Export posts as JSON and re-import to another site
wpklx @old-site post ls --format json --fields=all > posts.json
```

### Quick Lookups & Debugging

Quickly inspect content, check user roles, or debug API responses without navigating the WordPress admin dashboard.

```bash
# Check who authored a specific post
wpklx post get 42 --fields=id,title,author

# Debug the raw API response
wpklx --verbose user ls --per-page 1
```

## How It Works

On first run (or with `wpklx discover`), KLX fetches the API schema from your WordPress site's `/wp-json` endpoint. It parses the available routes, methods, and accepted parameters, then maps them to a consistent CLI syntax:

```
wpklx <resource> <action> [options]
```

This means if a plugin registers `/wp-json/my-plugin/v1/widgets`, you can immediately run:

```bash
wpklx widgets list
wpklx widgets get --id 5
```

No code changes required.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/KLIXPERT-io/wpklx/main/install.sh | bash
```

This downloads the latest binary for your platform to `~/.local/bin/wpklx`.

Pre-built binaries are available for Linux x64, macOS Intel, macOS Apple Silicon, and Windows x64 on the [releases page](https://github.com/KLIXPERT-io/wpklx/releases/tag/latest).

### From source

```bash
git clone https://github.com/KLIXPERT-io/wpklx.git
cd wpklx
bun install
bun link
```

## Quick Start

The fastest way to get started is with the interactive login command:

```bash
wpklx login
```

This walks you through connecting to a WordPress site — enter your host URL, username, and application password, and KLX will save a profile for you.

## Configuration

KLX supports two configuration methods: `.env` files for simple setups and YAML profiles for managing multiple WordPress sites.

### Option 1: Environment File

Create a `.env` file in your project root or working directory:

```env
# Required
WP_HOST=https://your-site.com
WP_USERNAME=admin
WP_APPLICATION_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx

# Optional
WP_API_PREFIX=/wp-json          # Default: /wp-json
WP_PER_PAGE=20                  # Default number of items per page
WP_TIMEOUT=30000                # Request timeout in ms (default: 30000)
WP_VERIFY_SSL=true              # SSL verification (default: true)
WP_OUTPUT_FORMAT=table          # Output format: table | json | yaml (default: table)
```

You can also pass a custom env file path:

```bash
wpklx --env /path/to/.env post list
```

### Option 2: YAML Profiles

For managing multiple WordPress sites, create a `wpklx.config.yaml` file in your project root or `~/.config/wpklx/config.yaml` for a global config:

```yaml
# Default profile used when no @name is specified
default: production

profiles:
  production:
    host: https://example.com
    username: admin
    application_password: xxxx xxxx xxxx xxxx xxxx xxxx
    output_format: table
    per_page: 20

  staging:
    host: https://staging.example.com
    username: admin
    application_password: yyyy yyyy yyyy yyyy yyyy yyyy
    verify_ssl: false

  local:
    host: http://localhost:8080
    username: admin
    application_password: zzzz zzzz zzzz zzzz zzzz zzzz
    api_prefix: /wp-json
    verify_ssl: false
    timeout: 5000
    output_format: json

  client-site:
    host: https://client.com
    username: editor
    application_password: aaaa aaaa aaaa aaaa aaaa aaaa
    per_page: 50
```

Switch between profiles using the `@name` syntax anywhere in your command:

```bash
# Use the "staging" profile
wpklx @staging post ls

# Use the "local" profile
wpklx @local post create --title "Test Post"

# Use the "client-site" profile
wpklx @client-site page ls --status draft

# Without @name, uses the "default" profile (production)
wpklx post ls
```

### Profile Management Commands

| Command                  | Description                          |
| ------------------------ | ------------------------------------ |
| `wpklx config ls`          | List all available profiles          |
| `wpklx config show`        | Show active profile details          |
| `wpklx config show @name`  | Show a specific profile's details    |
| `wpklx config add <name>`  | Interactively add a new profile      |
| `wpklx config rm <name>`   | Remove a profile                     |
| `wpklx config default <name>` | Set the default profile           |
| `wpklx config path`        | Print the config file path in use    |

### Config Resolution Order

Configuration is resolved with the following priority (highest first):

1. CLI flags (`--format json`)
2. `.env` file (`WP_OUTPUT_FORMAT=json`)
3. Active YAML profile (`output_format: json`)
4. Built-in defaults

### Application Password

WordPress application passwords are required for authentication. Generate one at:

**WordPress Admin > Users > Profile > Application Passwords**

## Usage

### General Syntax

```
wpklx [@profile] <resource> <action> [--option value] [flags]
```

### Built-in Commands

| Command            | Description                              |
| ------------------ | ---------------------------------------- |
| `wpklx login`       | Interactive WordPress site setup         |
| `wpklx discover`     | Fetch and cache the API schema           |
| `wpklx routes`       | List all discovered routes               |
| `wpklx config ls`    | List all profiles                        |
| `wpklx help`         | Show global help                         |
| `wpklx <resource> help` | Show help for a specific resource     |
| `wpklx version`      | Print version                            |

### Resource Actions

Standard CRUD actions are mapped from HTTP methods:

| Action     | Shortcut | HTTP Method | Description          |
| ---------- | -------- | ----------- | -------------------- |
| `list`     | `ls`     | GET         | List all items       |
| `get`      | `show`   | GET         | Get a single item    |
| `create`   | `new`    | POST        | Create an item       |
| `update`   | `edit`   | PUT/PATCH   | Update an item       |
| `delete`   | `rm`     | DELETE      | Delete an item       |

### Namespace Prefix

When multiple plugins register the same resource name, use a namespace prefix to target a specific one:

```bash
# Access "post" under the wpml namespace
wpklx wpml:post list

# Access "settings" under a custom plugin namespace
wpklx myplugin:settings get
```

The prefix matches against the route's namespace (e.g., `wpml/v1`, `myplugin/v1`). Without a prefix, `wp/v2` core routes are prioritized.

### Examples

```bash
# Posts
wpklx post list
wpklx post ls                          # shortcut
wpklx post ls --status draft
wpklx post get --id 42
wpklx post show 42                     # shortcut, positional ID
wpklx post create --title "Hello World" --status draft
wpklx post new --title "Hello World"   # shortcut
wpklx post update 42 --title "Updated Title"
wpklx post edit 42 --title="Updated"   # shortcut, positional ID, = syntax
wpklx post delete --id 42
wpklx post rm 42                       # shortcut
wpklx post delete --id 42 --force      # skip trash, permanent delete

# Pages
wpklx page list
wpklx page ls --status publish --per-page 50

# Categories & Tags
wpklx category ls
wpklx tag create --name "TypeScript"

# Media
wpklx media ls
wpklx media upload --file ./photo.jpg --title "Hero Image"

# Users
wpklx user ls
wpklx user get --id 1

# Comments
wpklx comment ls --post 42
wpklx comment rm 15

# Plugin-provided routes (auto-discovered)
wpklx widget ls
wpklx form ls

# Namespace prefix for plugin routes
wpklx wpml:post ls
wpklx woocommerce:product ls

# Multi-site with profiles
wpklx @staging post ls
wpklx @local post new --title "Test"
wpklx @client-site page ls --status draft
```

### Stdin Piping

KLX accepts piped input for creating and updating content. There are two ways to pipe data:

**Explicit flag with `-` sentinel** — specify which parameter receives stdin:

```bash
# Pipe content into a specific flag
echo "Hello World" | wpklx post create --content - --title "My Post"
cat draft.md | wpklx page update 12 --content -
echo "A new description" | wpklx category create --description - --name "News"
```

**Bare pipe** — when no `--flag -` is specified, stdin is auto-mapped to a sensible default parameter based on the resource:

| Resource   | Default parameter |
| ---------- | ----------------- |
| `post`     | `content`         |
| `page`     | `content`         |
| `comment`  | `content`         |
| `category` | `description`     |
| `tag`      | `description`     |
| `media`    | `file`            |
| *other*    | `content`         |

```bash
# These are equivalent:
echo "Hello" | wpklx post create --title "My Post"
echo "Hello" | wpklx post create --content - --title "My Post"

# Pipe binary data for media upload
cat photo.jpg | wpklx media upload --title "Hero Image" --mime-type image/jpeg
curl -s https://example.com/image.png | wpklx media upload --file - --title "Downloaded"
```

Stdin is only accepted for write actions (`create`, `update`). Using `--flag -` with `list`, `get`, or `delete` produces an error. If the default parameter is already provided via CLI args, bare-pipe stdin is ignored.

### Global Flags

```
--env <path>        Path to .env file
--format <type>     Output format: table, json, yaml
--fields <list>     Comma-separated fields to display (use --fields=all for every column)
--per-page <n>      Items per page
--page <n>          Page number
--quiet             Only output IDs
--verbose           Show request/response details
--no-color          Disable colored output
--help, -h          Show help
--version, -v       Show version
```

Flags accept both `--flag value` and `--flag=value` syntax.

By default, table output shows only essential columns (ID plus key fields like title, slug, status, date). Use `--fields=all` to show every column, or `--fields=id,title,status` to pick specific ones.

## Project Structure

```
wpklx/
├── src/
│   ├── index.ts                 # Entry point, CLI bootstrap
│   ├── cli/
│   │   ├── parser.ts            # Argument parsing, @profile extraction, namespace prefix
│   │   ├── commands.ts          # Command execution (discover, routes, config, resources)
│   │   ├── formatters.ts        # Table column selection, field filtering
│   │   ├── help.ts              # Help text generation
│   │   ├── login.ts             # Interactive site setup wizard
│   │   └── output.ts            # Output rendering (table, json, yaml, markdown)
│   ├── api/
│   │   ├── client.ts            # HTTP client with auth and error handling
│   │   ├── discovery.ts         # Route discovery from /wp-json
│   │   ├── schema.ts            # Schema parsing and route-to-command mapping
│   │   └── cache.ts             # Schema caching
│   ├── config/
│   │   ├── env.ts               # .env file loading and validation
│   │   ├── profiles.ts          # YAML profile loading and @name resolution
│   │   └── settings.ts          # Configuration defaults and merging
│   ├── helpers/
│   │   ├── logger.ts            # Logging with verbosity levels
│   │   ├── error.ts             # Error formatting and exit codes
│   │   ├── retry.ts             # Retry logic for transient failures
│   │   └── stdin.ts             # Stdin reading and --flag - resolution
│   └── types/
│       ├── api.ts               # API response and route types
│       ├── cli.ts               # CLI argument types
│       └── config.ts            # Configuration types
├── bunfig.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Error Handling

KLX is designed to be fault-tolerant:

- **Connection failures** — retries with exponential backoff (configurable)
- **Auth errors** — clear messages explaining how to fix credentials
- **404 / unknown routes** — suggests similar available commands
- **Malformed responses** — graceful fallback with raw output
- **Timeout** — configurable timeout with informative message
- **SSL errors** — option to disable verification for local development

All errors produce a non-zero exit code and a human-readable message. Use `--verbose` to see full request/response details for debugging.

### Exit Codes

| Code | Meaning                  |
| ---- | ------------------------ |
| 0    | Success                  |
| 1    | General error            |
| 2    | Configuration error      |
| 3    | Authentication error     |
| 4    | Resource not found       |
| 5    | Validation error         |
| 6    | Network / timeout error  |

## Development

```bash
# Run in development
bun run dev -- post list

# Type check
bun run typecheck

# Lint
bun run lint

# Build
bun run build
```
