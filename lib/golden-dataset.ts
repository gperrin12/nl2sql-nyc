import { existsSync, readFileSync } from "fs";
import path from "path";

export type GoldenDatasetEntry = {
  id: string;
  question: string;
  category: string;
  difficulty: string;
  ground_truth_answer: string | unknown[];
  expected_sql_pattern: string;
};

const DEFAULT_PATH = path.join(process.cwd(), "data", "golden-dataset.json");

export function loadGoldenDataset(
  filePath = DEFAULT_PATH
): GoldenDatasetEntry[] {
  if (!existsSync(filePath)) {
    throw new Error(`Golden dataset not found: ${filePath}`);
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("golden-dataset.json must be a JSON array");
  }
  return parsed as GoldenDatasetEntry[];
}
