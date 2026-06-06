"use client";

/**
 * RagTab.tsx — Documents tab for nl2sql-nyc
 *
 * A simple interface for querying the RAG endpoint.
 * Renders the answer with source citations alongside the retrieved chunks.
 *
 * Place this at: components/RagTab.tsx
 * Then import and add to the tab layout in your main page or query interface.
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types — mirror the response shape from POST /api/rag/query
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RagTab() {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<RagResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: RagResponse = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 max-w-3xl mx-auto">
      {/* Query input */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label htmlFor="rag-question" className="text-sm font-medium text-gray-700">
          Ask a question about NYC government documents
        </label>
        <textarea
          id="rag-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          placeholder="e.g. What was the Department of Sanitation's missed collection rate in FY2023?"
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !question.trim()}
          className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Searching documents..." : "Ask"}
        </button>
      </form>

      {/* Error state */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Answer */}
      {response && (
        <div className="flex flex-col gap-4">
          {/* Abstention indicator */}
          {response.abstained && (
            <div className="rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              {/* TODO: Show a clear message that the system didn't have enough information.
                  Something like: "No relevant documents found — the system abstained rather than guessing."
                  This is a feature, not an error. Make it visually distinct from an error. */}
              System abstained: no sufficiently relevant documents were found.
            </div>
          )}

          {/* Answer text */}
          <div className="rounded border border-gray-200 bg-white px-4 py-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Answer
            </h3>
            {/* TODO: Render response.answer here.
                Consider: should citations like [Source: ...] be rendered as styled badges
                or plain text? Plain text is fine for now. */}
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{response.answer}</p>
          </div>

          {/* Retrieved sources */}
          {response.chunks.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Retrieved Documents ({response.chunks.length})
              </h3>
              {response.chunks.map((chunk, i) => (
                // TODO: Render each chunk as a source card.
                // Show: source name, section (if present), page number (if present), similarity score.
                // Optionally show a truncated preview of the chunk content.
                // Keep it compact — this is reference info, not the main content.
                <div
                  key={chunk.id}
                  className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-gray-700">{chunk.source}</span>
                      {chunk.section && (
                        <span className="text-gray-500">{chunk.section}</span>
                      )}
                      {chunk.page_num && (
                        <span className="text-gray-400">p. {chunk.page_num}</span>
                      )}
                    </div>
                    <span
                      className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 font-mono"
                      title="Cosine similarity score"
                    >
                      {(chunk.similarity * 100).toFixed(1)}%
                    </span>
                  </div>
                  {/* Truncated content preview */}
                  <p className="mt-1.5 text-gray-500 line-clamp-2">{chunk.content}</p>
                </div>
              ))}
            </div>
          )}

          {/* Token usage */}
          {response.usage && (
            <p className="text-xs text-gray-400">
              {response.usage.input_tokens} input tokens · {response.usage.output_tokens} output tokens
            </p>
          )}
        </div>
      )}
    </div>
  );
}
