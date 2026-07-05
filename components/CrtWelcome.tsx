import type { ReactNode } from "react";

/**
 * Claude Code-style welcome banner — the orange ✻ sparkle, "Welcome to NL2SQL",
 * an optional NYC flag chip, and per-page descriptive lines passed as children.
 * Shared across the home, dashboard, and trivia pages.
 */
export function CrtWelcome({
  flag = true,
  productName = "NL2SQL",
  children,
}: {
  flag?: boolean;
  /** Highlighted product name after "Welcome to" (default: NL2SQL). */
  productName?: string;
  children?: ReactNode;
}) {
  return (
    <header className="crt-window p-5">
      <div className="crt-box p-4 space-y-2">
        <p className="text-base">
          <span className="crt-spark">✻</span>{" "}
          <span className="text-[var(--text)]">Welcome to </span>
          <span className="text-[var(--accent)] font-semibold">{productName}</span>
          {flag && (
            <span
              className="crt-flag ml-2"
              aria-label="New York City flag"
              role="img"
            >
              <i />
              <i />
              <i />
            </span>
          )}
        </p>
        {children}
      </div>
    </header>
  );
}
