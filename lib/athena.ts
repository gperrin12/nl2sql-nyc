import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  type QueryExecutionState,
} from "@aws-sdk/client-athena";
import { ATHENA_RESULT_FETCH_ROWS } from "@/lib/athenaLimits";

let athenaClient: AthenaClient | undefined;

function getAthenaClient(): AthenaClient {
  if (!athenaClient) {
    athenaClient = new AthenaClient({
      region: process.env.AWS_REGION?.trim() || "us-east-1",
    });
  }
  return athenaClient;
}

/** Read at call time so script loadEnvFile() runs before first query. */
function getAthenaQueryConfig(): {
  database: string;
  outputLocation: string;
  workgroup: string;
} {
  const outputLocation = process.env.ATHENA_OUTPUT_LOCATION?.trim() ?? "";
  if (!outputLocation) {
    throw new Error("ATHENA_OUTPUT_LOCATION env var is not set");
  }
  return {
    database: process.env.ATHENA_DATABASE?.trim() || "nyc_tlc",
    outputLocation,
    workgroup: process.env.ATHENA_WORKGROUP?.trim() || "primary",
  };
}

export type AthenaStatus = QueryExecutionState | "UNKNOWN";

export type AthenaResults = {
  columns: string[];
  rows: Record<string, string | null>[];
  scannedBytes: number;
  executionTimeMs: number;
};

/** Kick off an Athena query. Returns the executionId for polling. */
export async function startQuery(sql: string): Promise<string> {
  const { database, outputLocation, workgroup } = getAthenaQueryConfig();
  const command = new StartQueryExecutionCommand({
    QueryString: sql,
    QueryExecutionContext: { Database: database },
    ResultConfiguration: { OutputLocation: outputLocation },
    WorkGroup: workgroup,
  });
  const response = await getAthenaClient().send(command);
  if (!response.QueryExecutionId) {
    throw new Error("Athena did not return a QueryExecutionId");
  }
  return response.QueryExecutionId;
}

/** Poll Athena for query status. Cheap call — safe to invoke ~once per second. */
export async function getStatus(
  executionId: string
): Promise<{ state: AthenaStatus; reason?: string; scannedBytes: number; runtimeMs: number }> {
  const command = new GetQueryExecutionCommand({ QueryExecutionId: executionId });
  const response = await getAthenaClient().send(command);
  const exec = response.QueryExecution;
  return {
    state: (exec?.Status?.State as AthenaStatus) ?? "UNKNOWN",
    reason: exec?.Status?.StateChangeReason,
    scannedBytes: Number(exec?.Statistics?.DataScannedInBytes ?? 0),
    runtimeMs: Number(exec?.Statistics?.TotalExecutionTimeInMillis ?? 0),
  };
}

/** Fetch result rows for UI map + table preview (single Athena page; table shows a subset client-side). */
export async function getResults(
  executionId: string,
  maxRows = ATHENA_RESULT_FETCH_ROWS
): Promise<AthenaResults> {
  const status = await getStatus(executionId);

  const command = new GetQueryResultsCommand({
    QueryExecutionId: executionId,
    MaxResults: Math.min(maxRows + 1, 1000), // +1 for header row, capped at API max
  });
  const response = await getAthenaClient().send(command);

  const meta = response.ResultSet?.ResultSetMetadata?.ColumnInfo ?? [];
  const columns = meta.map((c) => c.Label ?? c.Name ?? "");

  // First row of ResultSet.Rows is a header echoing column names. Skip it.
  const rawRows = response.ResultSet?.Rows ?? [];
  const dataRows = rawRows.slice(1).map((row) => {
    const obj: Record<string, string | null> = {};
    columns.forEach((col, i) => {
      const cell = row.Data?.[i];
      obj[col] = cell?.VarCharValue ?? null;
    });
    return obj;
  });

  return {
    columns,
    rows: dataRows,
    scannedBytes: status.scannedBytes,
    executionTimeMs: status.runtimeMs,
  };
}
