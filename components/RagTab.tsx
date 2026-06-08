"use client";

import { useState } from "react";

interface Chunk {
  id: number;
  content: string;
  source: string;
  source_type: string | null;
  section: string | null;
  page_num: number | null;
  similarity: number;
}

interface RagResponse {
  answer: string;
  abstained: boolean;
  abstain_reason?: string;
  chunks: Chunk[];
  usage?: { input_tokens: number; output_tokens: number };
}

const EXAMPLES = [
  "What was Vision Zero summons activity in the first four months of FY2026?",
  "What was the Department of Sanitation's missed collection rate?",
  "How many motorcycle seizures did NYPD report for Vision Zero?",
  "What bicycle lane miles did DOT install?",
  "What were FDNY structural fire response times?",
];

function parseApiError(text: string): string {
  try {
    const data = JSON.parse(text) as { error?: string };
    return data.error ?? text;
  } catch {
    return text;
  }
}

function formatSource(source: string): string {
  if (source.startsWith("http")) {
    try {
      const path = new URL(source).pathname;
      const file = path.split("/").pop() ?? source;
      return file.replace(/\.pdf$/i, "").replace(/_/g, " ");
    } catch {
      return source;
    }
  }
  return source;
}

export function RagTab() {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<RagResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(questionText: string) {
    const trimmed = questionText.trim();
    if (!trimmed || isLoading) return;

    setQuestion(trimmed);
    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok) throw new Error(parseApiError(await res.text()));
      const data: RagResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2">
          <textarea
            id="rag-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void handleSubmit(question);
              }
            }}
            rows={3}
            placeholder="Ask a question about NYC government documents — Mayor's Management Report, agency performance, Vision Zero..."
            className="w-full bg-transparent outline-none resize-none text-base p-2 text-[var(--text)]"
            disabled={isLoading}
          />
          <div className="flex justify-between items-center px-2 pb-1">
            <span className="text-xs text-[var(--muted)]">
              Cmd/Ctrl + Enter to run
            </span>
            <button
              type="button"
              onClick={() => void handleSubmit(question)}
              disabled={isLoading || !question.trim()}
              className="px-4 py-1.5 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? "Searching..." : "Run"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setQuestion(ex)}
              disabled={isLoading}
              className="text-xs px-3 py-1 rounded-full border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent-dim)] disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--error)] bg-red-950/20 p-4">
          <p className="text-sm font-medium text-[var(--error)]">Query failed</p>
          <p className="text-xs font-mono whitespace-pre-wrap mt-1 text-[var(--text)]">
            {error}
          </p>
        </div>
      )}

      {response && (
        <div className="space-y-4">
          {response.abstained && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
              <p className="text-sm font-medium text-[var(--foreground)]">
                No relevant documents found
              </p>
              <p className="text-xs text-[var(--muted)] mt-1">
                The system abstained rather than guessing — try rephrasing or asking
                about MMR topics like sanitation, Vision Zero, or agency performance.
              </p>
            </div>
          )}

          <div className="rounded-lg border border-[var(--border)] border-l-4 border-l-[var(--accent)] bg-[var(--panel)] p-4">
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] mb-1">
              Answer
            </p>
            <p className="text-sm text-[var(--text)] leading-relaxed whitespace-pre-wrap">
              {response.answer}
            </p>
          </div>

          {response.chunks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)] px-1">
                Retrieved documents ({response.chunks.length})
              </p>
              {response.chunks.map((chunk, i) => (
                <div
                  key={chunk.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-xs font-medium text-[var(--foreground)] truncate">
                        [{i + 1}] {formatSource(chunk.source)}
                      </p>
                      {chunk.section && (
                        <p className="text-xs text-[var(--muted)]">{chunk.section}</p>
                      )}
                      {chunk.page_num != null && (
                        <p className="text-xs text-[var(--muted)]">p. {chunk.page_num}</p>
                      )}
                    </div>
                    <span
                      className="shrink-0 text-xs font-mono text-[var(--accent)]"
                      title="Cosine similarity"
                    >
                      {(Number(chunk.similarity) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)] leading-relaxed line-clamp-4 font-mono whitespace-pre-wrap">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          )}

          {response.usage && (
            <p className="text-xs text-[var(--muted)] px-1">
              {response.usage.input_tokens} input tokens ·{" "}
              {response.usage.output_tokens} output tokens
            </p>
          )}
        </div>
      )}
    </div>
  );
}
