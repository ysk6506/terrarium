/**
 * Putting the slices of a measurement together (ADR-0175). CI runs the browser half as several slices side by side
 * (tests/e2e/ux/parts.ts); each writes the fields it measured. The merge sums the clean-screen tallies, joins the
 * journeys, takes every other field from the one slice that wrote it, and hands the result to the same parser a whole
 * run's file goes through, so a missing or doubled field is an error, never a guess.
 */
import { type Measurements, parseMeasurements } from "./score";

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export interface Merged {
  readonly measurements: Measurements;
  /** What the slices noticed, in the order the slices were given. */
  readonly notes: string[];
}

interface Pool {
  readonly fields: Raw;
  readonly journeys: Raw;
  readonly clean: { tried: number; ok: number };
  readonly notes: string[];
}

function addJourneys(pool: Pool, value: unknown, at: number): void {
  if (!isObject(value)) throw new Error(`조각 ${at}의 journeys가 객체가 아니다`);
  for (const [id, outcome] of Object.entries(value)) {
    if (id in pool.journeys) throw new Error(`여정 ${id}이 두 조각에 있다`);
    pool.journeys[id] = outcome;
  }
}

function addClean(pool: Pool, value: unknown, at: number): void {
  if (!isObject(value) || typeof value.tried !== "number" || typeof value.ok !== "number")
    throw new Error(`조각 ${at}의 clean이 tried와 ok를 갖지 않는다`);
  pool.clean.tried += value.tried;
  pool.clean.ok += value.ok;
}

function addField(pool: Pool, key: string, value: unknown): void {
  if (key in pool.fields) throw new Error(`${key}가 두 조각에 있다`);
  pool.fields[key] = value;
}

function addPart(pool: Pool, part: unknown, at: number): void {
  if (!isObject(part)) throw new Error(`조각 ${at}이 객체가 아니다`);
  for (const [key, value] of Object.entries(part)) {
    if (key === "part") continue;
    if (key === "notes" && Array.isArray(value))
      pool.notes.push(...value.filter((n): n is string => typeof n === "string"));
    else if (key === "journeys") addJourneys(pool, value, at);
    else if (key === "clean") addClean(pool, value, at);
    else addField(pool, key, value);
  }
}

export function mergeParts(parts: readonly unknown[]): Merged {
  const pool: Pool = { fields: {}, journeys: {}, clean: { tried: 0, ok: 0 }, notes: [] };
  parts.forEach((part, index) => {
    addPart(pool, part, index + 1);
  });
  const measurements = parseMeasurements({
    ...pool.fields,
    journeys: pool.journeys,
    clean: pool.clean,
  });
  return { measurements, notes: pool.notes };
}
