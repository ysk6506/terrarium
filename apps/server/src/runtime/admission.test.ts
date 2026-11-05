import { describe, expect, test } from "vitest";
import { defaultThreadMb, Ledger, sessionMb, worldMb } from "./admission";

describe("a thread's memory is promised before sessions are put on it [REQ-032] [REQ-042]", () => {
  test("a bigger world costs more, per session and once per thread", () => {
    expect(sessionMb(40_000)).toBeGreaterThan(sessionMb(4_000) * 5);
    expect(worldMb(40_000)).toBeCloseTo(worldMb(4_000) * 10, 6);
  });

  test("sessions of a world already on the thread pay no second time for the world", () => {
    const ledger = new Ledger(1000);
    const first = ledger.costOf("w", 4_000);
    ledger.add("a", "w", 4_000);
    expect(ledger.costOf("w", 4_000)).toBeCloseTo(first - worldMb(4_000), 6);
    expect(ledger.usedMb).toBeCloseTo(sessionMb(4_000) + worldMb(4_000), 6);
  });

  test("a session fits while the promise holds, and not past it", () => {
    const entities = 4_000;
    const ledger = new Ledger(worldMb(entities) + 2.5 * sessionMb(entities));
    expect(ledger.fits("w", entities)).toBe(true);
    ledger.add("a", "w", entities);
    ledger.add("b", "w", entities);
    expect(ledger.fits("w", entities)).toBe(false);
    ledger.remove("a");
    expect(ledger.fits("w", entities)).toBe(true);
  });

  test("an empty thread takes any session, however large, since it would fit nowhere else", () => {
    const ledger = new Ledger(10);
    expect(ledger.fits("huge", 100_000)).toBe(true);
    ledger.add("a", "huge", 100_000);
    expect(ledger.fits("huge", 100_000)).toBe(false);
  });

  test("worlds past the cache limit are dropped oldest first, except those with a session", () => {
    const ledger = new Ledger(10_000, 10_000);
    ledger.add("a", "w1", 4_000);
    ledger.remove("a");
    ledger.add("b", "w2", 4_000);
    ledger.add("c", "w3", 4_000);
    expect(ledger.has("w1")).toBe(false);
    expect(ledger.has("w2")).toBe(true);
    expect(ledger.has("w3")).toBe(true);
  });

  test("a thread's share of the machine is whole megabytes and never below the floor", () => {
    expect(defaultThreadMb(1)).toBeGreaterThanOrEqual(512);
    expect(defaultThreadMb(64)).toBeGreaterThanOrEqual(512);
    expect(Number.isInteger(defaultThreadMb(2))).toBe(true);
    expect(defaultThreadMb(2)).toBeLessThanOrEqual(defaultThreadMb(1));
  });
});
