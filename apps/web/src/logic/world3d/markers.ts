/**
 * The markers the 3D view draws for the runs working in a world (REQ-050): where each run stands now,
 * the line of places before, how fresh it is, and what kind of act it was. Pure; the view only draws them.
 */
import { type ActivityState, IDLE_MS, type Worker } from "../activity";
import type { Spot } from "./spot";

export interface Marker {
  readonly runId: string;
  readonly hue: number;
  readonly effect: "observe" | "act" | "wait" | "answer";
  readonly ok: boolean;
  readonly at: Spot;
  /** The entity the marker stands at, for clicking through to it. */
  readonly target: string;
  /** Places before this one, oldest first. */
  readonly trail: readonly Spot[];
  /** When the run last did something, ms on the page's clock. */
  readonly lastAt: number;
  /** Markers at the same spot are stacked: this is its place in the pile. */
  readonly pile: number;
}

const sameSpot = (a: Spot, b: Spot): boolean =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.z - b.z) < 0.5 && Math.abs(a.y - b.y) < 2;

/** 1 when something just happened, down to 0 once the run has been quiet for IDLE_MS. */
export const freshness = (lastAt: number, now: number): number =>
  Math.max(0, Math.min(1, 1 - (now - lastAt) / IDLE_MS));

function markerOf(w: Worker, resolve: (id: string) => Spot | undefined): Marker | undefined {
  const at = w.at === undefined ? undefined : resolve(w.at);
  if (!w.at || !at) return undefined;
  const trail = w.trail.flatMap((id) => resolve(id) ?? []);
  return {
    runId: w.runId,
    hue: w.hue,
    effect: w.last?.effect ?? "observe",
    ok: w.last?.ok ?? true,
    at,
    target: w.at,
    trail,
    lastAt: w.lastAt,
    pile: 0,
  };
}

/** One marker for each run that has named equipment with a place in the site. */
export function markersOf(
  state: ActivityState,
  resolve: (id: string) => Spot | undefined,
): Marker[] {
  const made = state.workers.flatMap((w) => markerOf(w, resolve) ?? []);
  return made.map((m, i) => ({
    ...m,
    pile: made.slice(0, i).filter((o) => sameSpot(o.at, m.at)).length,
  }));
}
