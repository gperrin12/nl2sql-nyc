/**
 * Global trivia hi-scores: local file (dev) or S3 (Vercel / prod).
 *
 * Set HISCORES_S3_URI=s3://your-bucket/path/trivia-hiscores.json on Vercel.
 * The trivia API updates this object after each qualifying run.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  buildHiScoreEntry,
  mergeHiScore,
  parseHiScoresJson,
  sortHiScores,
  TRIVIA_LEADERBOARD_SIZE,
  TRIVIA_SESSION_LENGTH,
  type TriviaHiScoreEntry,
} from "@/lib/trivia-hiscores";

const LOCAL_PATH = path.join(process.cwd(), "data", "trivia-hiscores.json");

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const m = uri.trim().match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

function getS3Target(): { bucket: string; key: string } | null {
  const uri = process.env.HISCORES_S3_URI?.trim();
  if (!uri) return null;
  const parsed = parseS3Uri(uri);
  if (!parsed) {
    throw new Error(
      `Invalid HISCORES_S3_URI ${JSON.stringify(uri)} — expected s3://bucket/key`
    );
  }
  return parsed;
}

function s3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
  });
}

export function hiScoresStorageDescription(): string {
  const s3 = getS3Target();
  if (s3) return `s3://${s3.bucket}/${s3.key}`;
  return LOCAL_PATH;
}

/** Load hi-scores from S3 (if HISCORES_S3_URI) or data/trivia-hiscores.json. */
export async function loadHiScores(): Promise<TriviaHiScoreEntry[]> {
  const s3 = getS3Target();
  if (!s3) {
    try {
      return sortHiScores(
        parseHiScoresJson(readFileSync(LOCAL_PATH, "utf8"))
      ).slice(0, TRIVIA_LEADERBOARD_SIZE);
    } catch {
      return [];
    }
  }

  try {
    const res = await s3Client().send(
      new GetObjectCommand({ Bucket: s3.bucket, Key: s3.key })
    );
    const body = await res.Body?.transformToString("utf8");
    if (!body) return [];
    return sortHiScores(parseHiScoresJson(body)).slice(
      0,
      TRIVIA_LEADERBOARD_SIZE
    );
  } catch (e: unknown) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return [];
    }
    throw e;
  }
}

function writeLocalHiScores(json: string): void {
  mkdirSync(path.dirname(LOCAL_PATH), { recursive: true });
  writeFileSync(LOCAL_PATH, json, "utf8");
}

/** Persist hi-scores to S3 (when configured) or data/trivia-hiscores.json (dev). */
export async function saveHiScores(
  entries: TriviaHiScoreEntry[]
): Promise<TriviaHiScoreEntry[]> {
  const sorted = sortHiScores(entries).slice(0, TRIVIA_LEADERBOARD_SIZE);
  const json = JSON.stringify(sorted, null, 2);
  const s3 = getS3Target();

  if (s3) {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: s3.key,
        Body: json,
        ContentType: "application/json",
      })
    );
    // Mirror to disk in local dev only (Vercel FS is read-only).
    if (process.env.NODE_ENV === "development") {
      try {
        writeLocalHiScores(json);
      } catch {
        // ignore — S3 is source of truth when configured
      }
    }
  } else {
    writeLocalHiScores(json);
  }

  return sorted;
}

/** Read → merge → write; returns updated board and new entry. */
export async function submitHiScore(
  initials: string,
  score: number,
  total: number = TRIVIA_SESSION_LENGTH
): Promise<{ board: TriviaHiScoreEntry[]; entry: TriviaHiScoreEntry }> {
  const board = await loadHiScores();
  const entry = buildHiScoreEntry(initials, score, total);
  const next = await saveHiScores(mergeHiScore(board, entry));
  return { board: next, entry };
}
