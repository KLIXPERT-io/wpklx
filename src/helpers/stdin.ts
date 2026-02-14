import type { ParsedArgs } from "../types/cli.ts";
import { CliError, ExitCode } from "./error.ts";

/** Result of reading stdin */
export interface StdinResult {
  data: Buffer;
  text: string;
}

/** Default stdin parameter mapping by resource name */
const STDIN_DEFAULT_MAP: Record<string, string> = {
  post: "content",
  page: "content",
  comment: "content",
  category: "description",
  tag: "description",
  media: "file",
};

/** Reads all of stdin into a Buffer. */
export async function readStdin(): Promise<StdinResult> {
  const stream = Bun.stdin.stream();
  const buf = await Bun.readableStreamToArrayBuffer(stream);
  const data = Buffer.from(buf);
  return { data, text: data.toString("utf-8") };
}

/**
 * Resolves stdin input for the command:
 * 1. If --flag - was specified, reads stdin into that flag
 * 2. If stdin is piped (not TTY) and no --flag -, auto-maps based on resource
 */
export async function resolveStdin(parsed: ParsedArgs): Promise<void> {
  if (parsed.stdinFlag) {
    // Explicit --flag - was used
    if (process.stdin.isTTY) {
      throw new CliError(
        `--${parsed.stdinFlag} - expects piped input but stdin is a terminal`,
        ExitCode.VALIDATION,
      );
    }

    const { data, text } = await readStdin();

    if (data.length === 0) {
      throw new CliError(
        "Stdin is empty — no data to read",
        ExitCode.VALIDATION,
      );
    }

    if (parsed.stdinFlag === "file") {
      parsed.stdinData = data;
      parsed.options.file = "__stdin__";
    } else {
      parsed.options[parsed.stdinFlag] = text;
    }
    return;
  }

  // Bare pipe: stdin is piped but no --flag - was specified
  if (process.stdin.isTTY) return;

  const defaultParam = STDIN_DEFAULT_MAP[parsed.resource] ?? "content";

  // If the default parameter was already provided via CLI args, ignore stdin
  if (parsed.options[defaultParam] !== undefined) return;

  const { data, text } = await readStdin();

  if (data.length === 0) return; // Silently ignore empty bare pipe

  if (defaultParam === "file") {
    parsed.stdinData = data;
    parsed.options.file = "__stdin__";
  } else {
    parsed.options[defaultParam] = text;
  }
}
