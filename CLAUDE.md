# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KLX WordPress CLI — a dynamic, fault-tolerant CLI for the WordPress REST API. Built with Bun and TypeScript. The CLI discovers available routes from a WordPress site's `/wp-json` endpoint at runtime and generates commands automatically.

## Commands

```bash
bun install              # Install dependencies
bun run dev -- post list # Run in development mode
bun run build            # Build for production
bun run typecheck        # Type check
bun run lint             # Lint
```

## Architecture

The CLI follows `wpklx [@profile] <resource> <action> [options]` syntax. Resources and actions are not hardcoded — they are discovered dynamically from the WordPress REST API schema.

### Key modules

- **`src/index.ts`** — Entry point, bootstraps the CLI
- **`src/cli/parser.ts`** — Parses arguments, resolves `@profile`, routes `<resource> <action>` to the API client
- **`src/api/discovery.ts`** — Fetches and caches `/wp-json` schema, maps REST routes to CLI commands
- **`src/api/schema.ts`** — Transforms WordPress route definitions into command metadata (accepted params, HTTP methods)
- **`src/api/client.ts`** — HTTP client with Basic Auth (application passwords), retry logic, timeout handling
- **`src/config/profiles.ts`** — Loads YAML profiles from `wpklx.config.yaml`, resolves `@name` references
- **`src/config/env.ts`** — Loads `.env` files
- **`src/config/settings.ts`** — Merges config sources: CLI flags > .env > YAML profile > defaults

### Action shortcuts

`list`→`ls`, `get`→`show`, `create`→`new`, `update`→`edit`, `delete`→`rm`. These mappings are resolved in the parser before routing.

### Config resolution order

CLI flags > `.env` file > active YAML profile > built-in defaults.

### Exit codes

0=success, 1=general, 2=config, 3=auth, 4=not found, 5=validation, 6=network/timeout.

## Conventions

- Use Bun APIs (not Node.js equivalents) where available
- Helpers in `src/helpers/` are standalone utilities — keep them dependency-free and reusable
- Types live in `src/types/` — separate files for api, cli, and config types
- All errors must produce a non-zero exit code and a human-readable message
- Fault tolerance: retry with exponential backoff for transient failures, suggest similar commands for unknown routes
