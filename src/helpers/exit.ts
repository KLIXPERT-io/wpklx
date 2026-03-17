/**
 * Safe process exit that flushes stdout before terminating.
 *
 * Bun buffers stdout when it's not connected to a TTY (e.g., when output
 * is piped or the process is spawned by a non-interactive parent).
 * Calling process.exit() directly can kill the process before buffered
 * output is written, resulting in missing or truncated output.
 *
 * This helper ensures all pending stdout data is flushed before exiting.
 */
export async function safeExit(code: number = 0): Promise<never> {
  await new Promise<void>((resolve) => {
    process.stdout.write("", () => resolve());
  });
  process.exit(code);
}
