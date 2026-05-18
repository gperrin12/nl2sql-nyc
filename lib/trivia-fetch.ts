import type { TriviaProof } from "@/lib/trivia-proof";

export type TriviaQuestionResponse = {
  question: string;
  options: string[];
  correctIndex: number;
  sql: string;
  explanation: string;
  model: string;
  proof?: TriviaProof;
  results: {
    columns: string[];
    rows: Record<string, string | null>[];
  };
  scannedBytes: number;
  runtimeMs: number;
};

export async function fetchTriviaQuestion(): Promise<TriviaQuestionResponse> {
  const res = await fetch("/api/trivia/question", {
    method: "POST",
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
