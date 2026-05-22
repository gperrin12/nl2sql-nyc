/**
 * Resolve short git SHA for build-time env (next.config.js).
 * Safe when .git is missing — returns "".
 */
const { execSync } = require("child_process");

function shortSha(full) {
  const t = String(full).trim();
  return t.length >= 7 ? t.slice(0, 7) : t;
}

function resolveGitSha() {
  const vercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercel) return shortSha(vercel);

  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

module.exports = { resolveGitSha, shortSha };
