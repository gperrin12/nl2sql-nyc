"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Eval Dashboard" },
  { href: "/trivia", label: "Trivia" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-4 text-sm border-b border-[var(--border)] pb-3 mb-4">
      {links.map(({ href, label }) => {
        const active =
          href === "/dashboard"
            ? pathname === "/dashboard" || pathname.startsWith("/dashboard/")
            : pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={
              active
                ? "text-[var(--accent)] font-medium"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
