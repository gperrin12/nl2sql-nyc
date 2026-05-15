/**
 * Dashboard judge results: local file (dev) or S3 (Vercel / prod).
 *
 * Set EVALS_S3_URI=s3://your-bucket/path/evals.json on Vercel and when running
 * `npm run eval` locally so the script uploads and the API reads the same object.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { JudgeResult } from "@/lib/judge";

const LOCAL_PATH = path.join(process.cwd(), "data", "evals.json");

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const m = uri.trim().match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

function getS3Target(): { bucket: string; key: string } | null {
  const uri = process.env.EVALS_S3_URI?.trim();
  if (!uri) return null;
  const parsed = parseS3Uri(uri);
  if (!parsed) {
    throw new Error(
      `Invalid EVALS_S3_URI ${JSON.stringify(uri)} — expected s3://bucket/key`
    );
  }
  return parsed;
}

function s3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
  });
}

export function evalsStorageDescription(): string {
  const s3 = getS3Target();
  if (s3) return `s3://${s3.bucket}/${s3.key}`;
  return LOCAL_PATH;
}

function parseEvalsJson(raw: string): JudgeResult[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is JudgeResult =>
      e &&
      typeof e === "object" &&
      typeof (e as JudgeResult).question === "string" &&
      typeof (e as JudgeResult).verdict === "string"
  );
}

/** Load evals from S3 (if EVALS_S3_URI) or data/evals.json. */
export async function loadEvals(): Promise<JudgeResult[]> {
  const s3 = getS3Target();
  if (!s3) {
    try {
      return parseEvalsJson(readFileSync(LOCAL_PATH, "utf8"));
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
    return parseEvalsJson(body);
  } catch (e: unknown) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return [];
    }
    throw e;
  }
}

/** Write evals to S3 (when EVALS_S3_URI is set) and data/evals.json. */
export async function saveEvals(evals: JudgeResult[]): Promise<void> {
  const json = JSON.stringify(evals, null, 2);
  const s3 = getS3Target();

  mkdirSync(path.dirname(LOCAL_PATH), { recursive: true });
  writeFileSync(LOCAL_PATH, json, "utf8");

  if (s3) {
    await uploadEvalsJsonToS3(json, s3);
    return;
  }
}

/** Upload JSON to the bucket/key from EVALS_S3_URI (for eval:upload). */
export async function uploadEvalsJsonToS3(
  json: string,
  target?: { bucket: string; key: string }
): Promise<void> {
  const s3 = target ?? getS3Target();
  if (!s3) {
    throw new Error(
      "EVALS_S3_URI is not set — add e.g. EVALS_S3_URI=s3://your-bucket/nl2sql-nyc/evals.json to .env"
    );
  }

  await s3Client().send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: s3.key,
      Body: json,
      ContentType: "application/json",
    })
  );

  console.log(`Uploaded evals to s3://${s3.bucket}/${s3.key}`);
}

/** Upload existing data/evals.json without re-running the judge. */
export async function uploadLocalEvalsFile(): Promise<void> {
  const raw = readFileSync(LOCAL_PATH, "utf8");
  await uploadEvalsJsonToS3(raw);
}
