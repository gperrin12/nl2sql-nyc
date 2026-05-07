import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  type QueryExecutionState,
} from "@aws-sdk/client-athena";

const client = new AthenaClient({ region: process.env.AWS_REGION ?? "us-east-1" });

const DATABASE = process.env.ATHENA_DATABASE ?? "nyc_tlc";
const OUTPUT_LOCATION = process.env.ATHENA_OUTPUT_LOCATION ?? "";
const WORKGROUP = process.env.ATHENA_WORKGROUP ?? "primary";

export type AthenaStatus = QueryExecutionState | "UNKNOWN";

export type AthenaResults = {
  columns: string[];
  rows: Record<string, string | null>[];
  scannedBytes: number;
  executionTimeMs: number;
};

/** Kick off an Athena query. Returns the executionId for polling. */
export async function startQuery(sql: string): Promise<string> {
  if (!OUTPUT_LOCATION) {
    throw new Error("ATHENA_OUTPUT_LOCATION env var is not set");
  }
  const command = new StartQueryExecutionCommand({
    QueryString: sql,
    QueryExecutionContext: { Database: DATABASE },
    ResultConfiguration: { OutputLocation: OUTPUT_LOCATION },
    WorkGroup: WORKGROUP,
  });
  const response = await client.send(command);
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
  const response = await client.send(command);
  const exec = response.QueryExecution;
  return {
    state: (exec?.Status?.State as AthenaStatus) ?? "UNKNOWN",
    reason: exec?.Status?.StateChangeReason,
    scannedBytes: Number(exec?.Statistics?.DataScannedInBytes ?? 0),
    runtimeMs: Number(exec?.Statistics?.TotalExecutionTimeInMillis ?? 0),
  };
}

/** Fetch results for a SUCCEEDED query. Pages up to maxRows. */
export async function getResults(
  executionId: string,
  maxRows = 1000
): Promise<AthenaResults> {
  const status = await getStatus(executionId);

  const command = new GetQueryResultsCommand({
    QueryExecutionId: executionId,
    MaxResults: Math.min(maxRows + 1, 1000), // +1 for header row, capped at API max
  });
  const response = await client.send(command);

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
