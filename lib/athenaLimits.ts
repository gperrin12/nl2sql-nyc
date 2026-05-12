/**
 * Preview limits for Athena GetQueryResults (server + UI must stay aligned).
 * Athena caps MaxResults at 1000 including header row → max 999 data rows per request.
 */
export const ATHENA_RESULT_FETCH_ROWS = 999;

/** Rows rendered in the scrollable results table (subset of fetched rows). */
export const RESULT_TABLE_DISPLAY_ROWS = 10;
