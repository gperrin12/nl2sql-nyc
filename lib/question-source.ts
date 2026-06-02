/**
 * Classify judged dashboard rows by question bank membership (server-only).
 */

import { readFileSync } from "fs";
import path from "path";
import type { QuestionSource } from "@/lib/question-source-types";

export type { QuestionSource } from "@/lib/question-source-types";

const GOLDEN_PATH = path.join(process.cwd(), "data", "golden-dataset.json");
const BANK_PATH = path.join(process.cwd(), "data", "questions.json");

function normalizeQuestion(q: string): string {
  return q.trim();
}

function loadQuestionSet(filePath: string): Set<string> {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return new Set();
  const set = new Set<string>();
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      "question" in item &&
      typeof (item as { question: unknown }).question === "string"
    ) {
      set.add(normalizeQuestion((item as { question: string }).question));
    }
  }
  return set;
}

let goldenSet: Set<string> | null = null;
let bankSet: Set<string> | null = null;

function goldenQuestions(): Set<string> {
  if (!goldenSet) goldenSet = loadQuestionSet(GOLDEN_PATH);
  return goldenSet;
}

function bankQuestions(): Set<string> {
  if (!bankSet) bankSet = loadQuestionSet(BANK_PATH);
  return bankSet;
}

/** Golden wins when the same text appears in both JSON banks. */
export function getQuestionSource(question: string): QuestionSource {
  const key = normalizeQuestion(question);
  if (goldenQuestions().has(key)) return "golden";
  if (bankQuestions().has(key)) return "bank";
  return "adhoc";
}

/** Reset cached sets (tests). */
export function resetQuestionSourceCache(): void {
  goldenSet = null;
  bankSet = null;
}
