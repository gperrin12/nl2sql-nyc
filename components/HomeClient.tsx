"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QueryBox } from "@/components/QueryBox";
import { SqlDisplay } from "@/components/SqlDisplay";
import { ResultsTable } from "@/components/ResultsTable";
import { LoginForm } from "@/components/LoginForm";
import { AgentStreamTrace } from "@/components/AgentStreamTrace";
import type { AgentStreamPayload } from "@/lib/sql-agent/types";

type StartResponse = {
  executionId: string;
  sql: string;
  model: string;
};

type RepairResponse = StartResponse & {
  usage?: { inputTokens: number; outputTokens: number };
};

type StatusResponse = {
  state: string;
  reason?: string;
  scannedBytes: number;
  runtimeMs: number;
  columns?: string[];
  rows?: Record<string, string | null>[];
};

type ErrorResponse = {
  error: string;
  reason?: string;
  detail?: string;
  sql?: string;
};

type Props = { initialAuthed: boolean };

const MAX_REPAIR_ATTEMPTS = 5;

const AGENT_SSE = process.env.NEXT_PUBLIC_AGENT_SSE === "true";

export function HomeClient({ initialAuthed }: Props) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [generatedSql, setGeneratedSql] = useState<string | null>(null);
  const [generatedModel, setGeneratedModel] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [repairAttemptsUsed, setRepairAttemptsUsed] = useState(0);
  const [repairPromptDismissed, setRepairPromptDismissed] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStreamPayload[]>([]);
  const [streamBusy, setStreamBusy] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const startMutation = useMutation<StartResponse, Error, string>({
    mutationFn: async (question) => {
      const res = await fetch("/api/query/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) setAuthed(false);
        const err = data as ErrorResponse;
        throw Object.assign(new Error(err.error ?? "Error"), { data: err });
      }
      return data;
    },
    onSuccess: (data) => {
      setGeneratedSql(data.sql);
      setGeneratedModel(data.model);
      setExecutionId(data.executionId);
    },
  });

  const repairMutation = useMutation<
    RepairResponse,
    Error,
    { feedback: string }
  >({
    mutationFn: async ({ feedback }) => {
      if (!lastQuestion?.trim() || !generatedSql?.trim()) {
        throw new Error("Missing question or SQL for repair");
      }
      const res = await fetch("/api/query/repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: lastQuestion,
          sql: generatedSql,
          feedback,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) setAuthed(false);
        const err = data as ErrorResponse;
        throw Object.assign(new Error(err.error ?? "Repair failed"), {
          data: err,
        });
      }
      return data as RepairResponse;
    },
    onSuccess: (data) => {
      setRepairAttemptsUsed((n) => n + 1);
      setRepairPromptDismissed(false);
      setGeneratedSql(data.sql);
      setGeneratedModel(data.model);
      setExecutionId(data.executionId);
    },
  });

  const dispatchAgentPayload = useCallback((p: AgentStreamPayload) => {
    setAgentSteps((prev) => [...prev, p]);
    switch (p.type) {
      case "sql_generated":
        setGeneratedSql(p.sql);
        break;
      case "athena_started":
        setExecutionId(p.executionId);
        break;
      case "done":
        setGeneratedModel(p.model);
        break;
      case "error":
        setStreamError(
          p.detail ? `${p.message}: ${p.detail}` : p.message
        );
        break;
      case "guardrails_failed":
        setStreamError(`Guardrails rejected SQL: ${p.reason}`);
        break;
      case "athena_failed":
        setStreamError(`Athena rejected query: ${p.detail}`);
        break;
      default:
        break;
    }
  }, []);

  const statusQuery = useQuery<StatusResponse>({
    enabled: !!executionId,
    queryKey: ["status", executionId],
    queryFn: async () => {
      const res = await fetch(`/api/query/${executionId}`);
      if (!res.ok) {
        if (res.status === 401) setAuthed(false);
        throw new Error("Failed to fetch status");
      }
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1000;
      if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(data.state)) return false;
      return 1000;
    },
  });

  if (!authed) return <LoginForm onSuccess={() => setAuthed(true)} />;

  const handleSubmit = (question: string) => {
    repairMutation.reset();
    startMutation.reset();
    setLastQuestion(question);
    setRepairAttemptsUsed(0);
    setRepairPromptDismissed(false);
    setExecutionId(null);
    setGeneratedSql(null);
    setGeneratedModel(null);
    setStreamError(null);
    setAgentSteps([]);
    if (AGENT_SSE) {
      void runStreamingSubmit(question);
      return;
    }
    startMutation.mutate(question);
  };

  async function runStreamingSubmit(question: string) {
    setStreamBusy(true);
    setStreamError(null);
    setAgentSteps([]);
    try {
      const res = await fetch("/api/query/agent-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ question }),
      });

      if (res.status === 401) {
        setAuthed(false);
        return;
      }

      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok && !ct.includes("event-stream")) {
        const data = (await res.json().catch(() => ({}))) as ErrorResponse;
        throw Object.assign(
          new Error(data.error ?? `HTTP ${res.status}`),
          { data }
        );
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      await consumeAgentSse(res.body, dispatchAgentPayload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStreamError(msg);
    } finally {
      setStreamBusy(false);
    }
  }

  const isRunning =
    streamBusy ||
    startMutation.isPending ||
    repairMutation.isPending ||
    (statusQuery.data &&
      !["SUCCEEDED", "FAILED", "CANCELLED"].includes(statusQuery.data.state));

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">NYC Civic Data — Ask in English</h1>
        <p className="text-sm text-[var(--muted)]">
          Natural language → Athena SQL across taxi trips, 311 service requests,
          NYPD collisions, and ACS census tracts.
        </p>
      </header>

      <QueryBox onSubmit={handleSubmit} disabled={!!isRunning} />

      {AGENT_SSE && (agentSteps.length > 0 || streamBusy) && (
        <AgentStreamTrace steps={agentSteps} busy={streamBusy} />
      )}

      {streamError && (
        <div className="rounded-lg border border-[var(--error)] bg-red-950/20 p-4">
          <p className="text-sm font-medium text-[var(--error)]">Stream error</p>
          <p className="text-xs font-mono whitespace-pre-wrap mt-1">{streamError}</p>
        </div>
      )}

      {startMutation.isError && (
        <ErrorPanel
          title="Generation failed"
          message={(startMutation.error as Error).message}
          extra={(startMutation.error as Error & { data?: ErrorResponse }).data}
        />
      )}

      {generatedSql && (
        <div className="space-y-1">
          <SqlDisplay sql={generatedSql} />
          {generatedModel && (
            <p className="text-xs text-[var(--muted)] px-1">
              model: {generatedModel}
            </p>
          )}
        </div>
      )}

      {statusQuery.data && statusQuery.data.state !== "SUCCEEDED" && (
        <StatusPanel data={statusQuery.data} />
      )}

      {statusQuery.data?.state === "FAILED" &&
        lastQuestion &&
        generatedSql &&
        !repairPromptDismissed && (
          <RepairPrompt
            athenaReason={statusQuery.data.reason}
            attemptsRemaining={MAX_REPAIR_ATTEMPTS - repairAttemptsUsed}
            maxAttempts={MAX_REPAIR_ATTEMPTS}
            onConfirm={() =>
              repairMutation.mutate({
                feedback:
                  statusQuery.data?.reason?.trim() ||
                  "Athena reported FAILED with no detailed reason.",
              })
            }
            onDismiss={() => setRepairPromptDismissed(true)}
            isRepairing={repairMutation.isPending}
          />
        )}

      {repairMutation.isError && (
        <ErrorPanel
          title="Repair failed"
          message={(repairMutation.error as Error).message}
          extra={(repairMutation.error as Error & { data?: ErrorResponse }).data}
        />
      )}

      {statusQuery.data?.state === "SUCCEEDED" &&
        statusQuery.data.columns &&
        statusQuery.data.rows && (
          <ResultsTable
            columns={statusQuery.data.columns}
            rows={statusQuery.data.rows}
            scannedBytes={statusQuery.data.scannedBytes}
            runtimeMs={statusQuery.data.runtimeMs}
          />
        )}
    </main>
  );
}

async function consumeAgentSse(
  body: ReadableStream<Uint8Array>,
  onPayload: (p: AgentStreamPayload) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const json = line.startsWith("data: ")
          ? line.slice(6).trim()
          : line.slice(5).trim();
        if (!json) continue;
        const payload = JSON.parse(json) as AgentStreamPayload;
        onPayload(payload);
      }
    }
  }
}

function RepairPrompt({
  athenaReason,
  attemptsRemaining,
  maxAttempts,
  onConfirm,
  onDismiss,
  isRepairing,
}: {
  athenaReason?: string;
  attemptsRemaining: number;
  maxAttempts: number;
  onConfirm: () => void;
  onDismiss: () => void;
  isRepairing: boolean;
}) {
  const canRepair = attemptsRemaining > 0 && !isRepairing;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
      <p className="text-sm font-medium">Retry with AI repair?</p>
      <p className="text-xs text-[var(--muted)]">
        Athena failed on the SQL above. You can ask the model to revise it using
        the error details below (up to {maxAttempts} repairs per question).
      </p>
      {athenaReason && (
        <p className="text-xs font-mono whitespace-pre-wrap bg-black/20 rounded p-2 border border-[var(--border)]">
          {athenaReason}
        </p>
      )}
      <p className="text-xs text-[var(--muted)]">
        Attempts remaining:{" "}
        <span className="font-mono text-[var(--foreground)]">
          {Math.max(0, attemptsRemaining)}
        </span>{" "}
        / {maxAttempts}
      </p>
      {attemptsRemaining <= 0 ? (
        <div className="space-y-2 pt-1">
          <p className="text-xs text-[var(--muted)]">
            Maximum repair attempts reached for this question. Submit a new question or edit your wording.
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="px-4 py-2 rounded border border-[var(--border)] text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={!canRepair}
            onClick={onConfirm}
            className="px-4 py-2 rounded bg-[var(--accent)] text-black text-sm font-medium disabled:opacity-40"
          >
            {isRepairing ? "Repairing…" : "Repair with AI"}
          </button>
          <button
            type="button"
            disabled={isRepairing}
            onClick={onDismiss}
            className="px-4 py-2 rounded border border-[var(--border)] text-sm text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

function StatusPanel({ data }: { data: StatusResponse }) {
  const failed = data.state === "FAILED" || data.state === "CANCELLED";
  return (
    <div
      className={`rounded-lg border p-4 ${
        failed
          ? "border-[var(--error)] bg-red-950/20"
          : "border-[var(--border)] bg-[var(--panel)]"
      }`}
    >
      <p className="text-sm">
        State: <span className="font-mono">{data.state}</span>
      </p>
      {data.reason && (
        <p className="text-xs text-[var(--muted)] mt-1 font-mono whitespace-pre-wrap">
          {data.reason}
        </p>
      )}
    </div>
  );
}

function ErrorPanel({
  title,
  message,
  extra,
}: {
  title: string;
  message: string;
  extra?: ErrorResponse;
}) {
  return (
    <div className="rounded-lg border border-[var(--error)] bg-red-950/20 p-4 space-y-2">
      <p className="text-sm font-medium text-[var(--error)]">{title}</p>
      <p className="text-xs font-mono whitespace-pre-wrap">{message}</p>
      {extra?.reason && (
        <p className="text-xs text-[var(--muted)]">Reason: {extra.reason}</p>
      )}
      {extra?.detail && (
        <p className="text-xs text-[var(--muted)] font-mono whitespace-pre-wrap">
          {extra.detail}
        </p>
      )}
      {extra?.sql && (
        <pre className="text-xs font-mono bg-black/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">
          {extra.sql}
        </pre>
      )}
    </div>
  );
}
