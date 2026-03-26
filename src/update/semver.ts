/**
 * Minimal semver comparison — no external dependencies.
 * Supports X.Y.Z format only (no pre-release or build metadata).
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(version: string): SemVer | null {
  const cleaned = version.replace(/^v/, "");
  const parts = cleaned.split(".");
  if (parts.length !== 3) return null;

  const [major, minor, patch] = parts.map(Number);
  if (
    major === undefined || minor === undefined || patch === undefined ||
    isNaN(major) || isNaN(minor) || isNaN(patch)
  ) {
    return null;
  }

  return { major, minor, patch };
}

/**
 * Compares two semver strings.
 * Returns: positive if a > b, negative if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  return va.patch - vb.patch;
}
