import { getResults, getStatus, type AthenaResults } from "@/lib/athena";

const DEFAULT_POLL_MS = 1000;
const MAX_WAIT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type WaitForAthenaOptions = {
  pollMs?: number;
  maxWaitMs?: number;
};

/** Poll Athena until SUCCEEDED, then fetch result rows. */
export async function waitForAthenaResults(
  executionId: string,
  options?: WaitForAthenaOptions
): Promise<AthenaResults> {
  const pollMs = options?.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + (options?.maxWaitMs ?? MAX_WAIT_MS);

  while (Date.now() < deadline) {
    const status = await getStatus(executionId);
    if (status.state === "SUCCEEDED") {
      return getResults(executionId);
    }
    if (status.state === "FAILED" || status.state === "CANCELLED") {
      throw new Error(status.reason ?? `Query ${status.state}`);
    }
    await sleep(pollMs);
  }

  throw new Error("Athena query timed out after 120s");
}
