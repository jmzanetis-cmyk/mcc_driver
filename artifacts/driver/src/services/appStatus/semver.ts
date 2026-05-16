// Tiny semver comparator scoped to the app-status forced-update flow.
// Handles X.Y.Z and tolerates a trailing -prerelease / +build tag by
// stripping it before comparison. We deliberately don't pull in a full
// semver dependency for the few lines we need.

function parse(version: string): [number, number, number] {
  const cleaned = String(version || "0.0.0").trim().split(/[-+]/)[0] ?? "0.0.0";
  const parts = cleaned.split(".").map((n) => {
    const v = Number.parseInt(n, 10);
    return Number.isFinite(v) ? v : 0;
  });
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return [major, minor, patch];
}

/** Returns < 0 if a < b, 0 if equal, > 0 if a > b. */
export function compareSemver(a: string, b: string): number {
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

export function isVersionBelow(current: string, minimum: string): boolean {
  return compareSemver(current, minimum) < 0;
}
