"use client";

import Link from "next/link";
import {
  TRIVIA_DECK_LABELS,
  type TriviaDeck,
} from "@/lib/trivia-categories";

const DECK_ORDER: TriviaDeck[] = ["mta", "311", "grab-bag"];

const DECK_INTRO: Record<
  TriviaDeck,
  { title: string; tagline: string; blurb: string; samples: string[] }
> = {
  mta: {
    title: "NYC Subway Trivia",
    tagline: "Ten questions on how the city actually rides",
    blurb:
      "Busiest stations, late-night and weekend patterns, neighborhood ridership, and rankings you " +
      "won't guess — pulled live from MTA hourly ridership data.",
    samples: [
      "Which station has the highest share of after-midnight riders?",
      "Busiest subway station outside Manhattan?",
      "Which neighborhood's stations moved the most riders in 2025?",
    ],
  },
  "311": {
    title: "NYC 311 Trivia",
    tagline: "Ten questions on what New Yorkers complain about",
    blurb:
      "Noise, heat, rats, potholes — which borough and neighborhood tops each category, straight " +
      "from the city's 311 service-request data.",
    samples: [
      "Which borough logs the most noise complaints?",
      "Top complaint type citywide last year?",
    ],
  },
  "grab-bag": {
    title: "NYC Civic Data Trivia",
    tagline: "Ten questions across the whole warehouse",
    blurb:
      "A mix of subway, 311, taxi, collisions, and census — the full spread of NYC open data in one round.",
    samples: [
      "Which taxi zone has the highest average fare?",
      "Busiest subway station outside Manhattan?",
    ],
  },
};

export type TriviaHomeProps = {
  deck: TriviaDeck;
  onDeckChange: (d: TriviaDeck) => void;
  onStart: () => void;
  prefetching: boolean;
  prefetchReady: boolean;
  onViewLeaderboard?: () => void;
};

export function TriviaHome({
  deck,
  onDeckChange,
  onStart,
  prefetching,
  prefetchReady,
  onViewLeaderboard,
}: TriviaHomeProps) {
  const intro = DECK_INTRO[deck];

  return (
    <div className="space-y-6">
      <header className="crt-window p-5">
        <div className="crt-box p-4 space-y-2">
          <p className="text-base">
            <span className="crt-spark">✻</span>{" "}
            <span className="text-[var(--text)]">Choose your deck · </span>
            <span className="text-[var(--accent)] font-semibold font-mono uppercase tracking-wide">
              Solo trivia
            </span>
          </p>
          <p className="text-[var(--muted)] text-sm">
            Pick a dataset, then start — your first question loads while you read.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 space-y-4">
        <div>
          <h1 className="font-mono text-xl uppercase tracking-wide text-[var(--text)]">
            {intro.title}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{intro.tagline}</p>
        </div>
        <p className="text-sm text-[var(--text)] leading-relaxed">{intro.blurb}</p>
        <ul className="space-y-2">
          {intro.samples.map((sample) => (
            <li
              key={sample}
              className="rounded-md border border-[var(--border)] bg-[var(--bg)]/40 px-3 py-2 text-xs text-[var(--muted)]"
            >
              e.g. {sample}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted)] font-mono">
          Deck
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {DECK_ORDER.map((option) => {
            const selected = deck === option;
            const optionIntro = DECK_INTRO[option];
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => onDeckChange(option)}
                className={
                  selected
                    ? "rounded-lg border-2 border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-3 text-left transition-colors"
                    : "rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-left text-[var(--muted)] hover:border-[var(--accent-dim)] hover:text-[var(--text)] transition-colors"
                }
              >
                <span
                  className={`block text-xs font-mono uppercase tracking-wide ${
                    selected ? "text-[var(--accent)]" : ""
                  }`}
                >
                  {TRIVIA_DECK_LABELS[option]}
                </span>
                <span className="mt-1 block text-[10px] leading-snug opacity-80">
                  {optionIntro.tagline}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="space-y-2">
        <button
          type="button"
          onClick={onStart}
          className={`w-full rounded-md px-6 py-3 text-sm font-medium font-mono uppercase tracking-wide transition-colors ${
            prefetchReady
              ? "bg-[var(--accent)] text-black hover:bg-[var(--accent-dim)]"
              : "bg-[var(--accent)] text-black hover:bg-[var(--accent-dim)] animate-pulse"
          }`}
        >
          Start {intro.title}
        </button>
        {prefetching && !prefetchReady && (
          <p
            className="text-center text-xs text-[var(--muted)] font-mono"
            aria-live="polite"
          >
            warming up questions…
          </p>
        )}
        {prefetchReady && (
          <p className="text-center text-xs text-[var(--accent)] font-mono uppercase tracking-wide">
            ready
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/trivia/live"
          className="rounded-md border-2 border-[var(--accent)] px-4 py-2 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-colors font-mono uppercase tracking-wide"
        >
          ▶ Play with friends
        </Link>
        {onViewLeaderboard && (
          <button
            type="button"
            onClick={onViewLeaderboard}
            className="text-xs text-[var(--muted)] hover:text-[var(--accent)] underline font-mono uppercase"
          >
            High scores
          </button>
        )}
      </div>

      <p className="text-center text-[10px] text-[var(--muted)] leading-relaxed">
        Every answer is verified against a live query — nothing is made up.
      </p>
    </div>
  );
}
