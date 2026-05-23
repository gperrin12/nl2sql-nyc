import type { TriviaProof } from "@/lib/trivia-proof";
import type { TriviaSessionConstraints } from "@/lib/trivia-categories";

export type TriviaQuestionResponse = {
  question: string;
  options: string[];
  correctIndex: number;
  sql: string;
  explanation: string;
  model: string;
  categoryId?: string;
  categoryLabel?: string;
  proof?: TriviaProof;
  results: {
    columns: string[];
    rows: Record<string, string | null>[];
  };
  scannedBytes: number;
  runtimeMs: number;
};

export async function fetchTriviaQuestion(
  session?: TriviaSessionConstraints
): Promise<TriviaQuestionResponse> {
  const res = await fetch("/api/trivia/question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session ?? {}),
    cache: "no-store",
  });
  const data = (await res.json()) as TriviaQuestionResponse & {
    error?: string;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? "Failed to load question");
  }
  return data;
}
