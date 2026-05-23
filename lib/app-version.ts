import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";

let cached: string | null = null;

function shortSha(full: string): string {
  const t = full.trim();
  return t.length >= 7 ? t.slice(0, 7) : t;
}

/** Runtime git lookup (dev / local Node with .git). Not available on Vercel serverless. */
function gitShaFromRepo(): string | null {
  try {
    const root = process.cwd();
    if (!existsSync(path.join(root, ".git"))) return null;
    const sha = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Label stored on nl2sql.query_runs.app_version.
 *
 * Priority:
 * 1. APP_VERSION — manual override
 * 2. GIT_COMMIT_SHA — set in next.config.js at build/dev start
 * 3. VERCEL_GIT_COMMIT_SHA — on Vercel deploys
 * 4. git rev-parse — local runtime when .git exists (e.g. next dev)
 * 5. package.json version
 */
export function getAppVersion(): string {
  if (cached) return cached;

  const explicit = process.env.APP_VERSION?.trim();
  if (explicit) {
    cached = explicit.slice(0, 128);
    return cached;
  }

  const fromBuild = process.env.GIT_COMMIT_SHA?.trim();
  if (fromBuild) {
    cached = fromBuild.slice(0, 128);
    return cached;
  }

  const vercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercel) {
    cached = shortSha(vercel);
    return cached;
  }

  const live = gitShaFromRepo();
  if (live) {
    cached = live.slice(0, 128);
    return cached;
  }

  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    cached = (pkg.version ?? "0.0.0").slice(0, 128);
  } catch {
    cached = "unknown";
  }

  return cached;
}

/**
 * app_version filter for eval script against nl2sql.query_runs.
 * - omitted / empty → current deploy ({@link getAppVersion})
 * - "all" → no filter (every deploy)
 * - otherwise → exact match on stored app_version
 */
export function resolveQueryRunsAppVersion(
  explicit?: string | null
): string | undefined {
  const raw = explicit?.trim();
  if (!raw) return getAppVersion();
  if (raw.toLowerCase() === "all") return undefined;
  return raw.slice(0, 128);
}

/**
 * Optional deploy filter for dashboard (rows are still deduped to latest per question).
 * - omitted / "all" → any deploy
 * - "current" → {@link getAppVersion} only
 * - otherwise → exact app_version
 */
export function resolveDashboardAppVersionFilter(
  explicit?: string | null
): string | undefined {
  const raw = explicit?.trim();
  if (!raw || raw.toLowerCase() === "all") return undefined;
  if (raw.toLowerCase() === "current") return getAppVersion();
  return raw.slice(0, 128);
}
