# CLAUDE.md

Operational guide for AI agents working in this repo. For the full product
narrative, evals, and deploy details, see [`README.md`](./README.md). This file
is the fast map: layout, conventions, commands, and the invariants you must not
break.

## What this is

Natural language → Athena SQL over NYC civic data (TLC taxi trips, 311 service
requests, NYPD collisions, taxi zones, census/ACS demographics), plus an
optional RAG path over government documents (MMR, Community Board minutes). A
Next.js 14 (App Router) + TypeScript app. Anthropic for SQL generation, AWS
Athena for execution, Neon Postgres for run logging/evals.

## Commands

```bash
npm run dev          # next dev (http://localhost:3000)
npm run build        # next build
npm run lint         # next lint
npm run typecheck    # tsc --noEmit
npm test             # vitest run (one-shot)
npm run test:watch   # vitest watch
```

Before declaring work done, run `npm run typecheck` and `npm test`. Strict
TypeScript is on — fix type errors, don't suppress them.

Eval/seed scripts (require `NEON_DATABASE_URL`, usually `ANTHROPIC_API_KEY`):
`npm run eval`, `npm run run:eval`, `npm run eval:golden` (and `:dry` variants).
See README for what each judges and writes.

## Layout

- `app/` — App Router. UI routes (`dashboard/`, `trivia/`) and `app/api/*`
  route handlers. Key APIs: `query/start`, `query/[id]`, `query/agent-stream`,
  `query/repair`, `rag/query`.
- `lib/` — all server logic (large, flat). Notable modules:
  - `athena.ts`, `athena-wait.ts`, `athenaLimits.ts` — Athena client + caps
  - `guardrails.ts`, `agent-stream-guardrails.ts`, `run-guarded-sql.ts`,
    `ensure-guarded-sql.ts` — SQL safety layer
  - `sql-agent/` — tool-using agent loop (`run.ts`, `types.ts`)
  - `query-router.ts` — SQL vs RAG vs HYBRID classifier (Haiku)
  - `run-query-pipeline.ts` — end-to-end generate → guard → execute path
  - `judge*.ts`, `hallucination-*.ts`, `dashboard-*.ts` — eval + dashboard
  - `db.ts` — Neon Postgres pool; `claude.ts`/`anthropic-client.ts` — LLM clients
- `components/` — React client components (`QueryBox`, `ResultsPanel`,
  `AgentStreamTrace`, charts/maps, trivia).
- `scripts/` — eval/seed TS scripts (run via `tsx`); `scripts/sql/` holds DB
  migrations; Python (`chunk_and_embed.py`, scrapers) for the RAG ingest side.
- `data/` — golden dataset, question banks, eval fixtures.
- `__tests__/` — vitest unit tests.

## Conventions

- Import with the `@/*` path alias (maps to repo root), e.g.
  `import { checkSql } from "@/lib/guardrails"`.
- Server-only secrets via `process.env`; anything browser-exposed must be
  prefixed `NEXT_PUBLIC_`. Changing `NEXT_PUBLIC_*` requires a dev restart/rebuild.
- LLM models are pluggable via env (`CLAUDE_MODEL`); don't hardcode a model in
  new code where an existing module already reads it from env.
- Functions that touch external services (Athena, Postgres, Anthropic) return
  typed results and fail safe — logging inserts are fire-and-forget and must not
  throw into the request path (see `logRoutingDecision` for the pattern).
- Add a vitest test alongside changes to guardrails, query-outcome, hallucination
  detection, and other `lib/` logic that already has coverage in `__tests__/`.

## Invariants — do not break

- **Never bypass the SQL guardrails.** All generated SQL must pass
  `guardrails.checkSql` (reject DDL/DML, enforce a single read-only statement)
  before reaching Athena. Route new execution paths through
  `run-guarded-sql.ts` / `ensure-guarded-sql.ts`.
- **Preserve Athena cost controls.** Keep partition filtering and the workgroup
  `BytesScannedCutoffPerQuery` cap. Don't generate or enable unbounded scans.
- **Async Athena pattern is required.** Vercel function timeouts are short;
  `start` kicks off the query and the client polls `query/[id]`. Don't try to
  block on query completion inside a request handler.
- **Never commit secrets.** `.env`/`.env.local` are local only; `.env.example`
  is the template. Don't print secret values.
- The `nl2sql` Postgres schema (`query_runs`, `prompt_versions`, `routing_log`,
  etc.) is shared with the live dashboard. Schema changes go through a migration
  in `scripts/sql/` using `IF NOT EXISTS`.

## Gotchas

- `lib/` is intentionally flat and large (~70 files) — search before adding a
  new module; the helper you need may already exist.
- Production prompt is the `prompt_versions` row with `is_production = TRUE`
  (cached ~60s). A/B variants are selected via `--prompt-version` in eval runs.
- `venv/` and `node_modules/` are vendored deps — never edit or search them.
