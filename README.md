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

When Athena fails or returns unusable results, call **`POST /api/query/repair`** with JSON `{ "question", "sql", "feedback" }` where `feedback` is the Athena state reason (or your own notes). That runs a **repair pass** with the full dialect prompt and starts a new execution.

## Local setup

```bash
npm install
cp .env.example .env.local
# fill in ANTHROPIC_API_KEY, AWS creds, ATHENA_OUTPUT_LOCATION, APP_PASSWORD
npm run dev
```

Open http://localhost:3000.

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
