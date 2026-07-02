import { describe, expect, it, vi, afterEach } from "vitest";
import { computeTimeRemaining, shouldAutoReveal } from "@/lib/trivia-room";

describe("computeTimeRemaining", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the full window right after the question starts", () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(computeTimeRemaining(new Date(now).toISOString(), 60)).toBe(60);
  });

  it("counts down as time elapses", () => {
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start + 15_000);
    expect(computeTimeRemaining(new Date(start).toISOString(), 60)).toBe(45);
  });

  it("never goes below zero once the window has passed", () => {
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start + 90_000);
    expect(computeTimeRemaining(new Date(start).toISOString(), 60)).toBe(0);
  });

  it("returns zero for an unparseable timestamp", () => {
    expect(computeTimeRemaining("not-a-date", 60)).toBe(0);
  });
});

describe("shouldAutoReveal", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const freshStart = () => new Date().toISOString();

  it("does not reveal while the timer is running and not everyone has answered", () => {
    expect(
      shouldAutoReveal({
        startedAt: freshStart(),
        durationSeconds: 60,
        answeredCount: 1,
        expectedAnswerers: 3,
      })
    ).toBe(false);
  });

  it("reveals once the countdown has expired", () => {
    const start = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const startedAt = new Date(start).toISOString();
    vi.setSystemTime(start + 61_000);
    expect(
      shouldAutoReveal({
        startedAt,
        durationSeconds: 60,
        answeredCount: 0,
        expectedAnswerers: 3,
      })
    ).toBe(true);
  });

  it("reveals early once every expected player has answered", () => {
    expect(
      shouldAutoReveal({
        startedAt: freshStart(),
        durationSeconds: 60,
        answeredCount: 3,
        expectedAnswerers: 3,
      })
    ).toBe(true);
  });

  it("does not reveal early in a host-only room (no expected answerers)", () => {
    expect(
      shouldAutoReveal({
        startedAt: freshStart(),
        durationSeconds: 60,
        answeredCount: 0,
        expectedAnswerers: 0,
      })
    ).toBe(false);
  });

  it("does not reveal when the question has not started yet", () => {
    expect(
      shouldAutoReveal({
        startedAt: null,
        durationSeconds: 60,
        answeredCount: 0,
        expectedAnswerers: 3,
      })
    ).toBe(false);
  });
});
