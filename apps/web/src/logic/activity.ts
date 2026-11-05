/**
 * Who is working in a world right now (REQ-050): the server's activity events folded into one entry per
 * run. Each run keeps the equipment it named last and a short trail of the places before, so the 3D view
 * can put a marker where it works and a line behind it. Time comes in from outside (`now`, in ms), so
 * the same events always give the same state.
 */
import type { ActivityEvent, ActivityWho } from "@terrarium/core/contract";
import { type CallEffect, toolSpec } from "@terrarium/core/tools";

/** Runs are told apart by colour; with more running than colours, colours are shared. */
export const WORKER_HUES = 8;
/** Beyond this many runs the oldest are dropped from the picture (the experiments page still lists them). */
export const MAX_WORKERS = 60;
/** How many earlier places a run's line shows. */
export const TRAIL_LENGTH = 6;
/** A run that has done nothing for this long is shown faded. */
export const IDLE_MS = 12_000;

export interface WorkerCall {
  readonly tool: string;
  readonly effect: CallEffect;
  readonly ok: boolean;
  /** Simulated seconds into the run. */
  readonly t: number;
}

export interface Worker {
  readonly runId: string;
  readonly who: ActivityWho;
  /** Which of the colours it wears, 0..WORKER_HUES-1. */
  readonly hue: number;
  readonly calls: number;
  /** The equipment it named last. */
  readonly at?: string;
  /** Places it named before that, oldest first, without immediate repeats. */
  readonly trail: readonly string[];
  readonly last?: WorkerCall;
  readonly startedAt: number;
  readonly lastAt: number;
}

export interface ActivityState {
  readonly workers: readonly Worker[];
}

export const noActivity: ActivityState = { workers: [] };

/** The colour least worn by the runs there are, the lowest first. */
function freeHue(workers: readonly Worker[]): number {
  const worn = new Array<number>(WORKER_HUES).fill(0);
  for (const w of workers) worn[w.hue] = (worn[w.hue] ?? 0) + 1;
  return worn.indexOf(Math.min(...worn));
}

function started(
  state: ActivityState,
  runId: string,
  who: ActivityWho,
  now: number,
): ActivityState {
  const known = state.workers.some((w) => w.runId === runId);
  if (known) return { workers: state.workers.map((w) => (w.runId === runId ? { ...w, who } : w)) };
  const fresh: Worker = {
    runId,
    who,
    hue: freeHue(state.workers),
    calls: 0,
    trail: [],
    startedAt: now,
    lastAt: now,
  };
  return { workers: [...state.workers, fresh].slice(-MAX_WORKERS) };
}

function called(w: Worker, event: Extract<ActivityEvent, { type: "call" }>, now: number): Worker {
  const named = event.targets[0];
  const moved = named !== undefined && named !== w.at;
  const trail = moved && w.at !== undefined ? [...w.trail, w.at].slice(-TRAIL_LENGTH) : w.trail;
  return {
    ...w,
    calls: w.calls + 1,
    ...(named === undefined ? {} : { at: named }),
    trail,
    last: { tool: event.tool, effect: event.effect, ok: event.ok, t: event.t },
    lastAt: now,
  };
}

export function applyActivity(
  state: ActivityState,
  event: ActivityEvent,
  now: number,
): ActivityState {
  switch (event.type) {
    case "start":
      return started(state, event.runId, event.who, now);
    case "call":
      return {
        workers: state.workers.map((w) => (w.runId === event.runId ? called(w, event, now) : w)),
      };
    case "end":
      return { workers: state.workers.filter((w) => w.runId !== event.runId) };
  }
}

/** Parse the data of one activity event; undefined when it is not one. */
export function parseActivity(data: string): ActivityEvent | undefined {
  try {
    const event = JSON.parse(data) as ActivityEvent;
    return event && ["start", "call", "end"].includes(event.type) ? event : undefined;
  } catch {
    return undefined;
  }
}

export const EFFECT_LABELS: Readonly<Record<CallEffect, string>> = {
  observe: "살펴보는 중",
  act: "조작하는 중",
  wait: "기다리는 중",
  answer: "답을 냈어요",
};

/** What a run just did, in a few words: "장비 상세 · 살펴보는 중". */
export function doingOf(w: Worker): string {
  if (!w.last) return "시작했어요";
  const title = toolSpec(w.last.tool)?.title ?? w.last.tool;
  return `${title} · ${w.last.ok ? EFFECT_LABELS[w.last.effect] : "실패했어요"}`;
}

/** Whether a run has been quiet for a while. */
export const isIdle = (w: Worker, now: number): boolean => now - w.lastAt > IDLE_MS;

/** "agent · model" for a run; the harness goes on the second line. */
export function nameOf(who: ActivityWho): { readonly title: string; readonly detail: string } {
  return {
    title: who.model ? `${who.agent} · ${who.model}` : who.agent,
    detail: `${who.harness} · ${who.experiment}`,
  };
}
