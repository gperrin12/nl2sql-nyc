/**
 * Upload data/evals.json to S3 (no re-judging).
 *
 * Usage:
 *   set -a && source .env && set +a
 *   npm run eval:upload
 *
 * Requires EVALS_S3_URI and AWS credentials (same as Athena).
 */

import { uploadLocalEvalsFile } from "../lib/evals-store";

uploadLocalEvalsFile().catch((e) => {
  console.error(e);
  process.exit(1);
});
