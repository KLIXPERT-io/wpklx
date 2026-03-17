import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { readStdin } from "../helpers/stdin.ts";
import { serializeToBlocks } from "../helpers/wp-serialize.ts";
import { markdownToHtml } from "../vendor/mmd.ts";
import { safeExit } from "../helpers/exit.ts";

export interface MarkdownOptions {
  file?: string;
  output?: string;
  noH1?: boolean;
  quiet?: boolean;
}

/** Parse markdown-specific args from raw argv. */
export function parseMarkdownArgs(args: string[]): MarkdownOptions {
  const opts: MarkdownOptions = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--file" && args[i + 1]) {
      opts.file = args[i + 1]!;
      i += 2;
    } else if (arg === "--output" && args[i + 1]) {
      opts.output = args[i + 1]!;
      i += 2;
    } else if (arg === "--no-h1") {
      opts.noH1 = true;
      i++;
    } else if (arg === "--quiet") {
      opts.quiet = true;
      i++;
    } else if (arg === "--no-color") {
      // accepted but ignored for markdown
      i++;
    } else {
      i++;
    }
  }
  return opts;
}

/** Strip the first <h1> element from HTML. */
function stripFirstH1(html: string): string {
  return html.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/, "");
}

/**
 * Run the `markdown` command — converts Markdown to WordPress block HTML.
 */
export async function runMarkdown(rawArgs: string[]): Promise<void> {
  const opts = parseMarkdownArgs(rawArgs);

  let md: string;

  if (opts.file) {
    // --file takes precedence
    if (!process.stdin.isTTY && !opts.quiet) {
      process.stderr.write("Warning: --file provided, ignoring stdin input\n");
    }

    if (!existsSync(opts.file)) {
      process.stderr.write(`Error: File not found: ${opts.file}\n`);
      await safeExit(1);
    }

    md = readFileSync(opts.file, "utf-8");
  } else if (!process.stdin.isTTY) {
    // Read from stdin
    const { text } = await readStdin();
    md = text;
  } else {
    process.stderr.write(
      "Error: No input provided. Use --file <path> or pipe Markdown via stdin.\n",
    );
    await safeExit(1);
  }

  if (!md.trim()) {
    process.stderr.write("Error: Input is empty\n");
    await safeExit(1);
  }

  // Convert Markdown → HTML
  let html = markdownToHtml(md);

  if (opts.noH1) {
    html = stripFirstH1(html);
  }

  // Convert HTML → WordPress block HTML
  const blockHtml = await serializeToBlocks(html);

  if (opts.output) {
    const dir = dirname(opts.output);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(opts.output, blockHtml);
    if (!opts.quiet) {
      process.stderr.write(`Written to ${opts.output}\n`);
    }
  } else {
    // Strip trailing newlines to avoid artifacts for piped consumers
    process.stdout.write(blockHtml.replace(/\n+$/, ""));
  }
}
