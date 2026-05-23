import { isDatabaseConfigured } from "@/lib/db";

export type DashboardDataSource = "postgres" | "p8k8";

/** Where /dashboard and eval scripts load query history from. */
export function resolveDashboardDataSource(): DashboardDataSource {
  const raw = (process.env.DASHBOARD_SOURCE ?? process.env.EVAL_SOURCE ?? "auto")
    .trim()
    .toLowerCase();

  if (raw === "postgres" || raw === "db") return "postgres";
  if (raw === "p8k8") return "p8k8";

  return isDatabaseConfigured() ? "postgres" : "p8k8";
}

export function p8k8Configured(): boolean {
  return Boolean(
    process.env.P8K8_URL?.trim() && process.env.P8K8_AUTH_TOKEN?.trim()
  );
}
