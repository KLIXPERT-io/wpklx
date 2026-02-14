interface LoggerConfig {
  verbose?: boolean;
  quiet?: boolean;
  noColor?: boolean;
}

let config: LoggerConfig = {};

const noColorEnv = (): boolean =>
  process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "";

const isColorDisabled = (): boolean => config.noColor === true || noColorEnv();

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function colorize(text: string, code: string): string {
  if (isColorDisabled()) return text;
  return `${code}${text}${RESET}`;
}

function timestamp(): string {
  return `[${new Date().toISOString()}] `;
}

export const logger = {
  configure(opts: LoggerConfig): void {
    // Verbose and quiet are mutually exclusive — verbose wins with a warning
    if (opts.verbose && opts.quiet) {
      config = { ...opts, quiet: false };
      const prefix = colorize("WARN", YELLOW);
      console.error(
        prefix,
        "Both --verbose and --quiet specified. Using verbose mode.",
      );
    } else {
      config = { ...opts };
    }
  },

  get isVerbose(): boolean {
    return config.verbose === true;
  },

  get isQuiet(): boolean {
    return config.quiet === true;
  },

  /** Only outputs when verbose mode is enabled. Always goes to stderr. */
  debug(...args: unknown[]): void {
    if (!config.verbose) return;
    const prefix = colorize(timestamp() + "DEBUG", DIM);
    console.error(prefix, ...args);
  },

  /** Normal output. Suppressed in quiet mode. Goes to stderr. */
  info(...args: unknown[]): void {
    if (config.quiet) return;
    console.error(...args);
  },

  /** Always outputs to stderr. */
  warn(...args: unknown[]): void {
    const prefix = colorize("WARN", YELLOW);
    console.error(prefix, ...args);
  },

  /** Always outputs to stderr. */
  error(...args: unknown[]): void {
    const prefix = colorize("ERROR", RED);
    console.error(prefix, ...args);
  },
};
