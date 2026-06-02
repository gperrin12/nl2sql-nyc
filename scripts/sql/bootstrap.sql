-- Fresh nl2sql schema on Postgres (e.g. Neon). Run once in psql; safe to re-run.
-- Usage: psql "$NEON_DATABASE_URL" -f scripts/sql/bootstrap.sql
--
-- Run order:
--   1. create-prompt-versions.sql
--   2. create-query-runs.sql
--   3. create-repair-attempts.sql
--   4. add-execution-id-unique.sql   (partial unique on execution_id; required by app)
--   5. add-app-version.sql           (optional; app_version index for dashboard/eval)

\i scripts/sql/create-prompt-versions.sql
\i scripts/sql/create-query-runs.sql
\i scripts/sql/create-repair-attempts.sql
\i scripts/sql/add-execution-id-unique.sql
