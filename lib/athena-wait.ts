import { getResults, getStatus, type AthenaResults } from "@/lib/athena";

const POLL_MS = 1000;
const MAX_WAIT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll Athena until SUCCEEDED, then fetch result rows. */
export async function waitForAthenaResults(
  executionId: string
): Promise<AthenaResults> {
  const deadline = Date.now() + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const status = await getStatus(executionId);
    if (status.state === "SUCCEEDED") {
      return getResults(executionId);
    }
    if (status.state === "FAILED" || status.state === "CANCELLED") {
      throw new Error(status.reason ?? `Query ${status.state}`);
    }
    await sleep(POLL_MS);
  }

  throw new Error("Athena query timed out after 120s");
}
