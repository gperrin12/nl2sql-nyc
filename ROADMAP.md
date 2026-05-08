# Roadmap

Direction for NL → SQL over NYC civic data in Athena.

## v1 (shipped) — NL→SQL with guardrails, single-shot

## v2 — Agentic refactor, map rendering, query history

- Optional tool-using SQL agent (`CLAUDE_SQL_AGENT`) + `POST /api/query/repair`.
- Optional live **SSE agent trace** (`NEXT_PUBLIC_AGENT_SSE` + `POST /api/query/agent-stream`).
- Map rendering + browser query history (planned).

## v3 — Persistent chat memory (p8k8), conversation evals

## v4 — SQL eval harness with execution accuracy + bytes-scanned VES
