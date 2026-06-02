# NL → SQL: NYC Civic Data

Natural language → Athena SQL across NYC TLC taxi trips, 311 service requests,
NYPD collisions, taxi zones, and census tracts with ACS demographics.

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md).

## Stack

- **Next.js 14** (App Router)
- **TypeScript** strict
- **Anthropic SDK** for SQL generation (model is pluggable via `CLAUDE_MODEL`)
- **AWS SDK v3** for Athena
- **TanStack Query** for client polling
- **Tailwind** for styling

## Architecture

```
User question
   │
   ▼
POST /api/query/start
   ├─→ Anthropic API (NL → SQL)
   ├─→ guardrails.checkSql (reject DDL/DML, enforce single statement)
   └─→ Athena.startQueryExecution → returns executionId
   ▼
{ executionId, sql, model }
   │
   ▼
GET /api/query/[id]   (frontend polls every 1s)
   ├─→ Athena.getQueryExecution (status)
   └─→ if SUCCEEDED: getQueryResults → returns rows
```

The async pattern is required because Athena queries can take 5–60s and Vercel
hobby/pro tiers cap function execution well below that.

### Agentic SQL (optional)

Set `CLAUDE_SQL_AGENT=true` to use a **tool loop** instead of one-shot generation: the model calls `list_tables` and `get_schema` so it only loads relevant table definitions (fewer invented columns), then emits SQL.

Set **`NEXT_PUBLIC_AGENT_SSE=true`** so the UI calls **`POST /api/query/agent-stream`** instead of `/api/query/start`. You’ll see a live **agent trace** (round → reason → tool act/observe when applicable), then SQL, guardrails, and Athena in one streamed sequence. Rebuild or restart dev after changing `NEXT_PUBLIC_*` vars.

When Athena fails or returns unusable results, call **`POST /api/query/repair`** with JSON `{ "question", "sql", "feedback" }` where `feedback` is the Athena state reason (or your own notes). That runs a **repair pass** with the full dialect prompt and starts a new execution.

In the web UI, when a query ends in **`FAILED`**, a **Repair with AI** prompt appears (requires confirmation — not automatic). You get up to **5** repairs per submitted question; **Not now** hides the prompt until the next failed run.

## Evaluation & Baseline

**v3 Baseline** (12-question golden dataset, LLM-as-judge scoring with temperature=0):

| Metric | Value |
|--------|-------|
| Total queries evaluated | 12 |
| Correct (score 5) | 41.7% (5 queries) |
| Mostly correct (score 4) | 16.7% (2 queries) |
| Partial (score 3) | 16.7% (2 queries) |
| Mostly wrong (score 2) | 8.3% (1 query) |
| Incorrect (score 1) | 16.7% (2 queries) |
| Acceptable accuracy (score 4-5) | 58.3% |
| Average judge score | 3.58 |

This baseline represents the starting point for optimization work.

### Prompt engineering (A/B)

System prompts for the tool-using SQL agent live in **`nl2sql.prompt_versions`** (`version_name`, `system_prompt`, `is_production`). Eval runs tag each row in **`nl2sql.query_runs.prompt_version`**; production uses the row where **`is_production = TRUE`** (cached ~60s via `PROMPT_PRODUCTION_TTL_MS`).

| Variant | Approach |
|---------|----------|
| **v1-baseline** | Direct agent instructions: tool loop, then plain-English summary + SQL (no explicit reasoning scaffold). |
| **v2-chain-of-thought** | Same tool loop, but the model must reason step-by-step before emitting SQL (often wrapped in `<sql>…</sql>` tags). |

**Golden A/B comparison** (2026-05-29, 12-question golden dataset, full judge SQL + Athena result, agent backend):

| prompt_version | runs | Athena success | avg judge (1–5) | avg cost / query |
|----------------|------|----------------|-----------------|------------------|
| v1-baseline | 12 | 100% | 4.25 | $0.030 |
| v2-chain-of-thought | 12 | 100% | 4.08 | $0.035 |

Both variants achieved perfect Athena execution on the golden set. **v1-baseline** scored slightly higher on judge quality (+0.17 avg) at ~18% lower token cost. Chain-of-thought added latency and cost without a measurable quality gain on this benchmark — **v1-baseline** is the production prompt (`is_production = TRUE`).

Run an A/B yourself:

```bash
npm run eval:golden -- --prompt-version v1-baseline
npm run eval:golden -- --prompt-version v2-chain-of-thought
```

Compare in Postgres:

```sql
SELECT prompt_version,
       COUNT(*) AS runs,
       ROUND(100.0 * COUNT(*) FILTER (WHERE athena_state = 'SUCCEEDED')
             / NULLIF(COUNT(*), 0), 1) AS success_pct,
       ROUND(AVG(judge_overall), 2) AS avg_judge,
       ROUND(AVG(cost_usd)::numeric, 5) AS avg_cost_usd
FROM nl2sql.query_runs
WHERE prompt_version IN ('v1-baseline', 'v2-chain-of-thought')
GROUP BY prompt_version ORDER BY prompt_version;
```

## Local setup

```bash
npm install
cp .env.example .env.local
# fill in ANTHROPIC_API_KEY, AWS creds, ATHENA_OUTPUT_LOCATION, APP_PASSWORD
npm run dev
```

Open http://localhost:3000. When logged in, **`/dashboard`** shows **judged** runs only from **`nl2sql.query_runs`** — **latest judged run per question** in the selected time range. Filters: last 1d / 7d / 30d, golden vs question bank vs ad-hoc. Surfaces `judge_overall`, tokens, cost, and hallucination type. Requires **`NEON_DATABASE_URL`**. API: `?sinceDays=7`, `?questionSource=golden`, `?appVersion=…` for deploy filter.

**Eval script** (`npm run eval`) judges rows in Postgres and writes **`judge_overall`** plus **`judge_detail`** JSONB (`reasoning`, `verdict`, `judgedAt`) on each `query_runs` row; defaults to current deploy (`EVAL_APP_VERSION=all` for all deploys). Apply `scripts/sql/add-judge-detail.sql` once if the column is missing (eval scripts also run `ADD COLUMN IF NOT EXISTS`).

**Run + eval** (`npm run run:eval`) reads `data/questions.json`, generates SQL with the local tool-using agent (`CLAUDE_SQL_AGENT` or forced in eval), logs to Postgres, judges, and persists scores on `query_runs`. Use `npm run run:eval:full` for Athena+viz judging. No browser required.

**Golden eval** (`npm run eval:golden`) reads `data/golden-dataset.json` (12 curated questions), runs the **tool-using SQL agent**, executes on Athena, judges, and logs to `nl2sql.query_runs` with **`app_version`** (default in `lib/golden-eval-version.ts`) and **`prompt_version`** (from `--prompt-version`, default `v1-baseline`). A/B prompts: `npm run eval:golden -- --prompt-version v2-chain-of-thought`. Change deploy tag: `GOLDEN_APP_VERSION=v3.2 npm run eval:golden` or `--version v3.2`. Requires `NEON_DATABASE_URL`, `ANTHROPIC_API_KEY`, `ATHENA_OUTPUT_LOCATION`. Dry run: `npm run eval:golden:dry`. Filter: `RUN_LIMIT=1 SEED_IDS=agg-003 npm run eval:golden`. Re-judge logged rows: `EVAL_APP_VERSION=v3.1 npm run eval`.

### Dashboard on Vercel

Set **`NEON_DATABASE_URL`** on Vercel so `/dashboard` reads judged rows from Postgres. Run `npm run eval` (or `run:eval` / `eval:golden`) against the same database, then refresh `/dashboard` — no redeploy needed.

## Required AWS setup

1. **S3 bucket for Athena query results.** Create one if you don't have it.
   Set `ATHENA_OUTPUT_LOCATION=s3://your-bucket/athena-results/`.

2. **IAM credentials with Athena + S3 read on your data bucket.** The minimal
   policy needs:
   - `athena:StartQueryExecution`
   - `athena:GetQueryExecution`
   - `athena:GetQueryResults`
   - `glue:GetTable`, `glue:GetDatabase`, `glue:GetPartitions`
   - `s3:GetObject`, `s3:ListBucket` on the data bucket
   - `s3:PutObject`, `s3:GetObject` on the results bucket

3. **Athena workgroup with bytes-scanned cap (recommended).** In Athena
   console → Workgroups → create or edit a workgroup → set
   `BytesScannedCutoffPerQuery` to e.g. 5GB. Set `ATHENA_WORKGROUP` to that
   workgroup name. This is the hard backstop against runaway queries.

## Deploy to Vercel

1. Push to GitHub, import in Vercel.
2. Add all env vars from `.env.example` in Vercel project settings.
3. Vercel hobby tier function timeout is 10s — fine for `/api/query/start`
   (just kicks off Athena) and `/api/query/[id]` (just polls). The Athena
   query itself runs on AWS, not Vercel.

## Adding the map (commit 2)

Spatial queries return `geometry_wkt` columns or raw `latitude`/`longitude`.
The frontend will detect those and render with `react-map-gl` + Mapbox.
Set `NEXT_PUBLIC_MAPBOX_TOKEN` in env to enable.

## Adding query history (commit 2)

Browser-local via localStorage. No server-side history in v1.

## Cost notes

- Anthropic API: ~$0.003 per query (Sonnet 4.5, ~1k input + ~200 output tokens).
- Athena: $5 per TB scanned. With partition filtering and 5GB workgroup cap,
  ~$0.025 per query worst case; usually <$0.001 each.
- Vercel: free hobby tier covers a portfolio site easily.
