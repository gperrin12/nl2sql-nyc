"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QueryBox } from "@/components/QueryBox";
import { SqlDisplay } from "@/components/SqlDisplay";
import { ResultsTable } from "@/components/ResultsTable";
import { LoginForm } from "@/components/LoginForm";

type StartResponse = {
  executionId: string;
  sql: string;
  model: string;
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

export default function Home() {
  const [authed, setAuthed] = useState(true); // optimistic; API will 401 if wrong
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [generatedSql, setGeneratedSql] = useState<string | null>(null);
  const [generatedModel, setGeneratedModel] = useState<string | null>(null);

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
    setExecutionId(null);
    setGeneratedSql(null);
    setGeneratedModel(null);
    startMutation.mutate(question);
  };

  const isRunning =
    startMutation.isPending ||
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
