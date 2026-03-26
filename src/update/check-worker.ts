/**
 * Background worker script — spawned as a detached child process.
 * Receives the current version as argv[2], checks GitHub for updates,
 * and writes state file if a newer version is found.
 */
import { checkForUpdate } from "./checker.ts";

const currentVersion = process.argv[2];
if (!currentVersion) process.exit(1);

await checkForUpdate(currentVersion);
