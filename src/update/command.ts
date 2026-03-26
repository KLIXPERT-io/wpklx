import { checkForUpdate } from "./checker.ts";
import { readUpdateState } from "./state.ts";
import { performUpdate } from "./updater.ts";
import { compareSemver } from "./semver.ts";
import { logger } from "../helpers/logger.ts";

/**
 * Manual `wpklx update` command.
 * Forces an immediate version check (ignores cooldown) and installs if available.
 */
export async function runUpdate(currentVersion: string): Promise<void> {
  logger.info("Checking for updates...");

  const result = await checkForUpdate(currentVersion, true);

  if (!result.updateAvailable || !result.latestVersion) {
    logger.info(`wpklx v${currentVersion} is up to date.`);
    return;
  }

  const state = readUpdateState();
  if (!state || compareSemver(state.latest_version, currentVersion) <= 0) {
    logger.info(`wpklx v${currentVersion} is up to date.`);
    return;
  }

  await performUpdate(state);
}
