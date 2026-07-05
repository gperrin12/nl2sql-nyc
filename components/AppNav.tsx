"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Trivia" },
  { href: "/query", label: "Query" },
  { href: "/dashboard", label: "Eval Dashboard" },
] as const;

function isActive(pathname: string, href: (typeof links)[number]["href"]): boolean {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/trivia/");
  }
  if (href === "/dashboard") {
    return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  }
  return pathname === href;
}

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-4 text-sm border-b border-[var(--border)] pb-3 mb-4">
      {links.map(({ href, label }) => {
        const active = isActive(pathname, href);
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
