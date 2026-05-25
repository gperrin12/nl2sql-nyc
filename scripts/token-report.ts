/**
 * Token usage report for nl2sql.query_runs.
 *
 * Usage (loads .env / .env.local):
 *   npm run token:report
 *   npm run token:report -- --migrate
 */

import { loadEnvFile } from "../lib/load-env-file";

loadEnvFile();

import { runTokenReportCli } from "../lib/add-token-logging";

runTokenReportCli().catch((e) => {
  console.error(e);
  process.exit(1);
});
