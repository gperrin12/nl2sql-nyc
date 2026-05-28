import { existsSync, readFileSync } from "fs";
import path from "path";

export type QuestionBankEntry = {
  id: string;
  question: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  tables: string[];
  expectedViz: "chart" | "map" | "table";
  notes?: string;
};

const DEFAULT_PATH = path.join(process.cwd(), "data", "questions.json");

/** questions.json uses // section headers — strip line comments before parse */
export function parseJsonWithLineComments(raw: string): unknown {
  const stripped = raw
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return JSON.parse(stripped);
}

export function loadQuestionsFromFile(
  filePath = DEFAULT_PATH
): QuestionBankEntry[] {
  if (!existsSync(filePath)) {
    throw new Error(`Questions file not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = parseJsonWithLineComments(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("questions.json must be a JSON array");
  }
  return parsed as QuestionBankEntry[];
}

export type QuestionFilterable = {
  id: string;
  category: string;
  difficulty: string;
};

/** Filters via SEED_IDS, SEED_CATEGORY, SEED_DIFFICULTY (same as npm run seed). */
export function applyQuestionFilters<T extends QuestionFilterable>(
  questions: T[]
): T[] {
  let list = questions;

  const idsRaw = process.env.SEED_IDS?.trim();
  if (idsRaw) {
    const ids = new Set(
      idsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    );
    list = list.filter((q) => ids.has(q.id));
  }

  const category = process.env.SEED_CATEGORY?.trim();
  if (category) {
    list = list.filter((q) => q.category === category);
  }

  const difficulty = process.env.SEED_DIFFICULTY?.trim();
  if (difficulty) {
    list = list.filter((q) => q.difficulty === difficulty);
  }

  return list;
}
