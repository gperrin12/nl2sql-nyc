"use client";

import type { AgentStreamPayload } from "@/lib/sql-agent/types";

type Props = { steps: AgentStreamPayload[]; busy?: boolean };

const LABELS: Partial<Record<AgentStreamPayload["type"], string>> = {
  turn: "Round",
  reason: "Note",
  summary: "Summary",
  tool_act: "Act",
  tool_observe: "Observe",
  sql_generated: "SQL",
  guardrails_failed: "Guardrails",
  athena_started: "Athena",
  athena_failed: "Athena",
  done: "Done",
  error: "Error",
};

export function AgentStreamTrace({ steps, busy }: Props) {
  if (steps.length === 0 && !busy) return null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-black/20">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Agent trace
        </p>
        {busy && (
          <span className="text-[10px] font-mono text-[var(--accent)] animate-pulse">
            running…
          </span>
        )}
      </div>
      <ol className="max-h-72 overflow-y-auto text-xs divide-y divide-[var(--border)]">
        {steps.map((step, i) => (
          <li key={i} className="px-3 py-2 space-y-1 font-mono">
            <StreamStepRow step={step} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function StreamStepRow({ step }: { step: AgentStreamPayload }) {
  const chip = LABELS[step.type] ?? step.type;

  switch (step.type) {
    case "turn":
      return (
        <>
          <span className="text-[var(--muted)]">{chip}</span>{" "}
          <span className="text-[var(--foreground)]">{step.index + 1}</span>
        </>
      );
    case "reason":
      return (
        <>
          <span className="text-emerald-500/90">{chip}</span>
          <p className="text-[var(--muted)] whitespace-pre-wrap pl-0 pt-0.5">{step.text}</p>
        </>
      );
    case "summary":
      return (
        <>
          <span className="text-[var(--accent)]">{chip}</span>
          <p className="text-[var(--foreground)] whitespace-pre-wrap pl-0 pt-0.5 text-[13px] leading-snug">
            {step.text}
          </p>
        </>
      );
    case "tool_act":
      return (
        <>
          <span className="text-sky-500/90">{chip}</span>{" "}
          <span className="text-[var(--foreground)]">{step.name}</span>
          <pre className="text-[10px] text-[var(--muted)] mt-1 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto">
            {formatJson(step.input)}
          </pre>
        </>
      );
    case "tool_observe":
      return (
        <>
          <span className="text-amber-500/90">{chip}</span>{" "}
          <span className="text-[var(--foreground)]">{step.name}</span>
          <span className="text-[var(--muted)] text-[10px]"> ({step.bytes} bytes)</span>
          <pre className="text-[10px] text-[var(--muted)] mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">
            {step.preview}
          </pre>
        </>
      );
    case "sql_generated":
      return (
        <>
          <span className="text-violet-400/90">{chip}</span>
          <pre className="text-[10px] text-[var(--muted)] mt-1 whitespace-pre-wrap max-h-28 overflow-y-auto">
            {step.sql.slice(0, 2000)}
            {step.sql.length > 2000 ? "\n…" : ""}
          </pre>
        </>
      );
    case "guardrails_failed":
      return (
        <>
          <span className="text-[var(--error)]">{chip}</span>
          <p className="text-[var(--error)]">{step.reason}</p>
          {step.abstention?.error_type && (
            <p className="text-[10px] text-[var(--muted)]">
              {step.abstention.reason}
              {step.abstention.error_type
                ? ` · ${step.abstention.error_type}`
                : ""}
            </p>
          )}
        </>
      );
    case "athena_started":
      return (
        <>
          <span className="text-teal-500/90">{chip}</span>{" "}
          <span className="text-[var(--foreground)] break-all">{step.executionId}</span>
        </>
      );
    case "athena_failed":
      return (
        <>
          <span className="text-[var(--error)]">{chip}</span>
          <p className="text-[var(--error)] whitespace-pre-wrap">{step.detail}</p>
        </>
      );
    case "done":
      return (
        <>
          <span className="text-[var(--muted)]">{chip}</span>
          <span className="text-[var(--foreground)]"> {step.model}</span>
          <span className="text-[var(--muted)] text-[10px]">
            {" "}
            · {step.usage.inputTokens} in / {step.usage.outputTokens} out tokens
          </span>
        </>
      );
    case "error":
      return (
        <>
          <span className="text-[var(--error)]">{chip}</span>
          <p className="text-[var(--error)]">{step.message}</p>
          {step.detail && (
            <p className="text-[var(--muted)] text-[10px] whitespace-pre-wrap">{step.detail}</p>
          )}
        </>
      );
    default:
      return (
        <span className="text-[var(--muted)]">{JSON.stringify(step)}</span>
      );
  }
}

function formatJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
