import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export interface UpdateState {
  latest_version: string;
  current_version: string;
  download_url: string;
  checked_at: string;
  notified: boolean;
}

const STATE_DIR = join(homedir(), ".config", "wpklx");
const STATE_FILE = join(STATE_DIR, "update-state.json");

export function getStatePath(): string {
  return STATE_FILE;
}

export function readUpdateState(): UpdateState | null {
  try {
    const content = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(content);
    if (
      typeof parsed.latest_version === "string" &&
      typeof parsed.current_version === "string" &&
      typeof parsed.download_url === "string" &&
      typeof parsed.checked_at === "string" &&
      typeof parsed.notified === "boolean"
    ) {
      return parsed as UpdateState;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeUpdateState(state: UpdateState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function deleteUpdateState(): void {
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // File doesn't exist or can't be deleted — ignore
  }
}

export function markNotified(): void {
  const state = readUpdateState();
  if (state) {
    state.notified = true;
    writeUpdateState(state);
  }
}
