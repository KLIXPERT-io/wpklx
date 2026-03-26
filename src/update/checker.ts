import { readUpdateState, writeUpdateState } from "./state.ts";
import { compareSemver, parseSemver } from "./semver.ts";

const GITHUB_REPO = "KLIXPERT-io/wpklx";
const CHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Internal flag used to trigger background check mode */
export const BG_CHECK_FLAG = "--__update-check";

interface GitHubRelease {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

/**
 * Spawns a detached background process that checks for updates.
 * Re-invokes the current binary with a hidden flag so it runs the check
 * instead of the normal CLI flow. Works with compiled binaries.
 */
export function spawnBackgroundCheck(currentVersion: string): void {
  // Skip in dev mode (running via bun directly)
  if (isDevMode()) return;

  // Check cooldown before spawning
  const state = readUpdateState();
  if (state) {
    const elapsed = Date.now() - new Date(state.checked_at).getTime();
    if (elapsed < CHECK_COOLDOWN_MS) return;
  }

  try {
    const proc = Bun.spawn(
      [process.execPath, BG_CHECK_FLAG, currentVersion],
      { stdio: ["ignore", "ignore", "ignore"], detached: true },
    );
    proc.unref();
  } catch {
    // Can't spawn background process — silently skip
  }
}

/**
 * Performs the actual version check against GitHub API.
 * Called directly by the background worker script and by `wpklx update`.
 */
export async function checkForUpdate(
  currentVersion: string,
  ignoreCooldown = false,
): Promise<{ updateAvailable: boolean; latestVersion?: string; downloadUrl?: string }> {
  // Check cooldown
  if (!ignoreCooldown) {
    const state = readUpdateState();
    if (state) {
      const elapsed = Date.now() - new Date(state.checked_at).getTime();
      if (elapsed < CHECK_COOLDOWN_MS) {
        // Still within cooldown — check if existing state shows an update
        if (compareSemver(state.latest_version, currentVersion) > 0) {
          return { updateAvailable: true, latestVersion: state.latest_version, downloadUrl: state.download_url };
        }
        return { updateAvailable: false };
      }
    }
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `wpklx/${currentVersion}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      // Rate limited or other error — silently skip, write checked_at to extend cooldown
      writeCheckedAt(currentVersion);
      return { updateAvailable: false };
    }

    const release = (await response.json()) as GitHubRelease;
    const remoteVersion = release.tag_name.replace(/^v/, "");

    if (!parseSemver(remoteVersion)) {
      writeCheckedAt(currentVersion);
      return { updateAvailable: false };
    }

    const downloadUrl = resolveAssetUrl(release);

    if (compareSemver(remoteVersion, currentVersion) > 0 && downloadUrl) {
      writeUpdateState({
        latest_version: remoteVersion,
        current_version: currentVersion,
        download_url: downloadUrl,
        checked_at: new Date().toISOString(),
        notified: false,
      });
      return { updateAvailable: true, latestVersion: remoteVersion, downloadUrl };
    }

    // Already on latest or newer
    writeCheckedAt(currentVersion);
    return { updateAvailable: false };
  } catch {
    // Network error, timeout, etc. — silently skip
    return { updateAvailable: false };
  }
}

function writeCheckedAt(currentVersion: string): void {
  const existing = readUpdateState();
  if (existing) {
    existing.checked_at = new Date().toISOString();
    writeUpdateState(existing);
  } else {
    writeUpdateState({
      latest_version: currentVersion,
      current_version: currentVersion,
      download_url: "",
      checked_at: new Date().toISOString(),
      notified: false,
    });
  }
}

function resolveAssetUrl(release: GitHubRelease): string | null {
  const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const suffix = platform === "windows" ? ".exe" : "";
  const expectedName = `wpklx-${platform}-${arch}${suffix}`;

  const asset = release.assets.find((a) => a.name === expectedName);
  return asset?.browser_download_url ?? null;
}

function isDevMode(): boolean {
  // In dev mode, the binary is bun itself (not the compiled wpklx binary)
  const execPath = process.execPath.toLowerCase();
  return execPath.includes("bun") || execPath.includes(".bun");
}
