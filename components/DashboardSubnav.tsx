"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/queries", label: "Query detail" },
  { href: "/dashboard/trivia", label: "Trivia" },
] as const;

export function DashboardSubnav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 w-fit">
      {links.map(({ href, label }) => {
        const active =
          href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={
              active
                ? "rounded-md bg-[var(--bg)] px-3 py-1.5 text-xs font-medium text-[var(--text)] shadow-sm"
                : "rounded-md px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)]"
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
