/**
 * 둘러보기 (REQ-077, ADR-0083): asked once, on the first "작게 시작" of a browser. A yes makes the 다음 할 일 칩 point at
 * five places in turn; a no leaves the chip alone. What was answered is kept in this browser (every access guarded,
 * like the settings), and so is what a person has already learned from the screen: the line that says the picture
 * moves when dragged goes away after the first drag.
 */
import type { KeyValueStore } from "./identity";
import { TOUR_STEPS } from "./next-step";

export const TOUR_KEY = "terrarium.tour";
export const LEARNED_KEY = "terrarium.learned";

type Store = Pick<KeyValueStore, "getItem" | "setItem">;

/** `pending`: asked of this world, not answered yet. `world`+`step`: running. `done`: never ask again. */
export interface TourSave {
  readonly done?: true;
  readonly pending?: string;
  readonly world?: string;
  readonly step?: number;
}

export type TourMode = "ask" | "run" | "none";

function readJson(store: Pick<Store, "getItem"> | undefined, key: string): Record<string, unknown> {
  try {
    const text = store?.getItem(key);
    const raw = text ? JSON.parse(text) : undefined;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function writeJson(store: Store | undefined, key: string, value: unknown): void {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch {
    // kept for this visit only
  }
}

export function readTour(store: Pick<Store, "getItem"> | undefined): TourSave {
  const raw = readJson(store, TOUR_KEY);
  if (raw.done === true) return { done: true };
  const step = typeof raw.step === "number" ? raw.step : undefined;
  return {
    ...(typeof raw.pending === "string" ? { pending: raw.pending } : {}),
    ...(typeof raw.world === "string" && step !== undefined && step >= 0 && step < TOUR_STEPS.length
      ? { world: raw.world, step }
      : {}),
  };
}

/** A new small site was made: ask about the tour in it, unless it was answered before. */
export function queueTour(store: Store | undefined, worldId: string): TourSave {
  const now = readTour(store);
  if (now.done || now.world) return now;
  const next: TourSave = { pending: worldId };
  writeJson(store, TOUR_KEY, next);
  return next;
}

/** The answer: yes starts the tour at its first step; no is final. */
export function answerTour(store: Store | undefined, worldId: string, yes: boolean): TourSave {
  const next: TourSave = yes ? { world: worldId, step: 0 } : { done: true };
  writeJson(store, TOUR_KEY, next);
  return next;
}

/** One step on; past the last, the tour is over. */
export function advanceTour(store: Store | undefined, save: TourSave): TourSave {
  const step = (save.step ?? 0) + 1;
  const next: TourSave =
    step >= TOUR_STEPS.length || !save.world ? { done: true } : { world: save.world, step };
  writeJson(store, TOUR_KEY, next);
  return next;
}

/** Whether the tour has something to do in this world. */
export function tourMode(save: TourSave, worldId: string): TourMode {
  if (save.pending === worldId) return "ask";
  return save.world === worldId && save.step !== undefined ? "run" : "none";
}

// ── what the screen has already taught ───────────────────────────────────────────────────────

export type Lesson = "drag";

export const hasLearned = (store: Pick<Store, "getItem"> | undefined, lesson: Lesson): boolean =>
  readJson(store, LEARNED_KEY)[lesson] === true;

export function learn(store: Store | undefined, lesson: Lesson): void {
  writeJson(store, LEARNED_KEY, { ...readJson(store, LEARNED_KEY), [lesson]: true });
}
