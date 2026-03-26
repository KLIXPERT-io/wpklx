import type { AutoUpdateMode } from "../types/config.ts";
import { readUpdateState, markNotified } from "./state.ts";
import { compareSemver } from "./semver.ts";
import { performUpdate } from "./updater.ts";
import { spawnBackgroundCheck } from "./checker.ts";
import { logger } from "../helpers/logger.ts";

/**
 * Step 1 of the update lifecycle — called at CLI startup.
 * Reads the state file and either auto-updates or notifies the user.
 *
 * The auto_update mode is determined from the state file's context:
 * - At startup we don't yet have the full config resolved, so we read
 *   the WP_AUTO_UPDATE env var directly for the mode decision.
 *   This is intentional — the startup check must be fast and config-free.
 */
export async function handleUpdateOnStartup(currentVersion: string): Promise<void> {
  const state = readUpdateState();
  if (!state) return;

  // Only act if there's actually a newer version
  if (compareSemver(state.latest_version, currentVersion) <= 0) return;

  // Determine mode from env (fast path — no config resolution needed)
  const mode = resolveAutoUpdateMode();

  if (mode === "off") return;

  if (mode === "auto") {
    await performUpdate(state);
    return;
  }

  if (mode === "notify" && !state.notified) {
    logger.info(
      `\nUpdate available: wpklx v${currentVersion} -> v${state.latest_version}\n` +
        `Run \`wpklx update\` to install the latest version.\n`,
    );
    markNotified();
  }
}

/**
 * Step 3 of the update lifecycle — called after command execution.
 * Spawns a detached background process to check GitHub for updates.
 */
export function scheduleBackgroundCheck(
  currentVersion: string,
  mode: AutoUpdateMode,
): void {
  if (mode === "off") return;
  spawnBackgroundCheck(currentVersion);
}

function resolveAutoUpdateMode(): AutoUpdateMode {
  const envVal = process.env["WP_AUTO_UPDATE"]?.toLowerCase();
  if (envVal === "auto" || envVal === "notify" || envVal === "off") {
    return envVal;
  }
  return "auto";
}
