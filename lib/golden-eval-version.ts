/** Default tag for nl2sql.query_runs.app_version on golden eval runs. Bump when starting a new baseline. */
export const DEFAULT_GOLDEN_APP_VERSION = "v3.1";

/**
 * Resolve golden eval version label (stored on query_runs.app_version).
 * Priority: --version=… / --version … → GOLDEN_APP_VERSION env → default.
 */
export function resolveGoldenAppVersion(argv: string[] = process.argv): string {
  const eqFlag = argv.find((a) => a.startsWith("--version="));
  if (eqFlag) {
    const value = eqFlag.slice("--version=".length).trim();
    if (value) return value.slice(0, 128);
  }

  const idx = argv.indexOf("--version");
  if (idx >= 0) {
    const value = argv[idx + 1]?.trim();
    if (value && !value.startsWith("-")) return value.slice(0, 128);
  }

  const fromEnv = process.env.GOLDEN_APP_VERSION?.trim();
  if (fromEnv) return fromEnv.slice(0, 128);

  return DEFAULT_GOLDEN_APP_VERSION;
}
