import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { DashboardClient } from "@/components/DashboardClient";

export default async function DashboardPage() {
  if (!(await isAuthenticated())) {
    redirect("/");
  }
  return <DashboardClient />;
}
