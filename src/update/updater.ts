import { mkdirSync, chmodSync, renameSync, copyFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { deleteUpdateState, type UpdateState } from "./state.ts";
import { logger } from "../helpers/logger.ts";

const TMP_DIR = join(homedir(), ".config", "wpklx");
const TMP_FILE = join(TMP_DIR, ".wpklx-update-tmp");

/**
 * Downloads and replaces the current binary with the new version.
 * Returns true on success, false on failure.
 */
export async function performUpdate(state: UpdateState): Promise<boolean> {
  const binaryPath = getBinaryPath();
  if (!binaryPath) {
    logger.warn("Cannot determine binary path. Run the install script to update manually.");
    return false;
  }

  try {
    // Download to temp file
    logger.info(`Downloading wpklx v${state.latest_version}...`);
    const response = await fetch(state.download_url, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      logger.warn(`Download failed (HTTP ${response.status}). Try again later or run the install script.`);
      return false;
    }

    const data = await response.arrayBuffer();
    if (data.byteLength === 0) {
      logger.warn("Downloaded file is empty. Try again later.");
      return false;
    }

    // Write to temp file
    mkdirSync(dirname(TMP_FILE), { recursive: true });
    await Bun.write(TMP_FILE, data);
    chmodSync(TMP_FILE, 0o755);

    // Atomic replace: try rename first (same filesystem = atomic)
    try {
      renameSync(TMP_FILE, binaryPath);
    } catch {
      // Cross-device fallback: copy + unlink
      try {
        copyFileSync(TMP_FILE, binaryPath);
        chmodSync(binaryPath, 0o755);
        unlinkSync(TMP_FILE);
      } catch (copyErr) {
        logger.warn(
          `Permission denied replacing binary at ${binaryPath}.\n` +
            `Try: sudo wpklx update`,
        );
        cleanup();
        return false;
      }
    }

    deleteUpdateState();
    logger.info(`Updated wpklx v${state.current_version} -> v${state.latest_version}`);
    return true;
  } catch (err) {
    logger.warn(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    cleanup();
    return false;
  }
}

function getBinaryPath(): string | null {
  const execPath = process.execPath;
  // In compiled binary mode, execPath is the binary itself
  // In dev mode, execPath is bun — don't update bun
  if (execPath.toLowerCase().includes("bun") || execPath.toLowerCase().includes(".bun")) {
    return null;
  }
  return execPath;
}

function cleanup(): void {
  try {
    unlinkSync(TMP_FILE);
  } catch {
    // Ignore
  }
}
