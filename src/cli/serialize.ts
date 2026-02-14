import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { readStdin } from "../helpers/stdin.ts";
import { serializeToBlocks } from "../helpers/wp-serialize.ts";

export interface SerializeOptions {
  file?: string;
  output?: string;
  noH1?: boolean;
  quiet?: boolean;
}

/** Parse serialize-specific args from raw argv. */
export function parseSerializeArgs(args: string[]): SerializeOptions {
  const opts: SerializeOptions = {};
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
      // accepted but ignored for serialize
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
 * Run the `serialize` command — converts HTML to WordPress block HTML.
 */
export async function runSerialize(rawArgs: string[]): Promise<void> {
  const opts = parseSerializeArgs(rawArgs);

  let html: string;

  if (opts.file) {
    // --file takes precedence
    if (!process.stdin.isTTY) {
      process.stderr.write("Warning: --file provided, ignoring stdin input\n");
    }

    if (!existsSync(opts.file)) {
      process.stderr.write(`Error: File not found: ${opts.file}\n`);
      process.exit(1);
    }

    html = readFileSync(opts.file, "utf-8");
  } else if (!process.stdin.isTTY) {
    // Read from stdin
    const { text } = await readStdin();
    html = text;
  } else {
    process.stderr.write(
      "Error: No input provided. Use --file <path> or pipe HTML via stdin.\n",
    );
    process.exit(1);
  }

  if (!html.trim()) {
    process.stderr.write("Error: Input is empty\n");
    process.exit(1);
  }

  if (opts.noH1) {
    html = stripFirstH1(html);
  }

  const blockHtml = await serializeToBlocks(html);

  if (opts.output) {
    const dir = dirname(opts.output);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(opts.output, blockHtml);
  } else {
    process.stdout.write(blockHtml);
  }
}
