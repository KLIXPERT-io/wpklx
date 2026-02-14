import type { ParsedArgs } from "../types/cli.ts";
import { CliError, ExitCode } from "./error.ts";

/** Result of reading stdin */
export interface StdinResult {
  data: Buffer;
  text: string;
}

/** Reads all of stdin into a Buffer. */
export async function readStdin(): Promise<StdinResult> {
  const stream = Bun.stdin.stream();
  const buf = await Bun.readableStreamToArrayBuffer(stream);
  const data = Buffer.from(buf);
  return { data, text: data.toString("utf-8") };
}

/**
 * If a --flag - was specified, reads stdin and injects the content
 * into parsed.options[stdinFlag].
 */
export async function resolveStdin(parsed: ParsedArgs): Promise<void> {
  if (!parsed.stdinFlag) return;

  // --flag - was used but stdin is a TTY (not piped)
  if (process.stdin.isTTY) {
    throw new CliError(
      `--${parsed.stdinFlag} - expects piped input but stdin is a terminal`,
      ExitCode.VALIDATION,
    );
  }

  const { text } = await readStdin();

  if (text.length === 0) {
    throw new CliError(
      "Stdin is empty — no data to read",
      ExitCode.VALIDATION,
    );
  }

  parsed.options[parsed.stdinFlag] = text;
}
