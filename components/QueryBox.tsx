"use client";

import { useState } from "react";

type Props = {
  onSubmit: (question: string) => void;
  disabled: boolean;
};

const EXAMPLES = [
  "Top 10 zones by yellow taxi pickups in November 2024",
  "311 noise complaints by borough in 2024",
  "Crashes per capita by census tract in Brooklyn for 2024",
  "Median household income by NTA, sorted descending",
];

export function QueryBox({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (value.trim() && !disabled) onSubmit(value.trim());
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder="Ask a question about NYC civic data — taxi trips, 311 complaints, crashes, demographics, census tracts..."
          rows={3}
          className="w-full bg-transparent outline-none resize-none text-base p-2"
          disabled={disabled}
        />
        <div className="flex justify-between items-center px-2 pb-1">
          <span className="text-xs text-[var(--muted)]">
            Cmd/Ctrl + Enter to run
          </span>
          <button
            onClick={submit}
            disabled={disabled || !value.trim()}
            className="px-4 py-1.5 rounded-md bg-[var(--accent)] text-black text-sm font-medium hover:bg-[var(--accent-dim)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {disabled ? "Running..." : "Run"}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => setValue(ex)}
            disabled={disabled}
            className="text-xs px-3 py-1 rounded-full border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--accent-dim)]"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
