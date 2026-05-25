/**
 * @deprecated Use: npm run token:report
 * Kept so older exercise commands still work.
 */
import { loadEnvFile } from "../lib/load-env-file";

loadEnvFile();

import { runTokenReportCli } from "../lib/add-token-logging";

const migrate = process.argv.includes("--migrate");
if (migrate) {
  console.log("Tip: npm run token:report -- --migrate\n");
}

runTokenReportCli(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
