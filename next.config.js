const { resolveGitSha } = require("./scripts/resolve-git-sha");

/** Baked at `next dev` / `next build` — used when APP_VERSION is unset. */
const gitCommitSha = resolveGitSha();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    GIT_COMMIT_SHA: gitCommitSha,
  },
};

module.exports = nextConfig;
