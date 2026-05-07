"use client";

import { useState } from "react";

type Props = { onSuccess: () => void };

export function LoginForm({ onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) onSuccess();
    else setError("Wrong password");
  };

  return (
    <form
      onSubmit={submit}
      className="max-w-sm mx-auto mt-32 p-6 rounded-lg border border-[var(--border)] bg-[var(--panel)] space-y-3"
    >
      <h2 className="text-lg font-medium">Enter access password</h2>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-2 outline-none focus:border-[var(--accent)]"
        autoFocus
      />
      {error && <p className="text-sm text-[var(--error)]">{error}</p>}
      <button
        type="submit"
        disabled={loading || !password}
        className="w-full py-2 rounded bg-[var(--accent)] text-black font-medium disabled:opacity-40"
      >
        {loading ? "..." : "Continue"}
      </button>
    </form>
  );
}
