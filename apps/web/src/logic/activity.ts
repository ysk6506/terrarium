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

/** Another team at work on a machine for a run (REQ-093): the engineer the 3D view shows walking there. */
export interface PartnerWork {
  readonly runId: string;
  readonly handoff: string;
  readonly device: string;
  readonly team: string;
  readonly who: "team" | "vendor";
  readonly replacing: boolean;
  readonly onSite: boolean;
}

export interface ActivityState {
  readonly workers: readonly Worker[];
  readonly partners?: readonly PartnerWork[];
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
  if (known)
    return { ...state, workers: state.workers.map((w) => (w.runId === runId ? { ...w, who } : w)) };
  const fresh: Worker = {
    runId,
    who,
    hue: freeHue(state.workers),
    calls: 0,
    trail: [],
    startedAt: now,
    lastAt: now,
  };
  return { ...state, workers: [...state.workers, fresh].slice(-MAX_WORKERS) };
}

const sameWork = (a: PartnerWork, b: Pick<PartnerWork, "runId" | "handoff" | "device">) =>
  a.runId === b.runId && a.handoff === b.handoff && a.device === b.device;

function partnered(
  state: ActivityState,
  event: Extract<ActivityEvent, { type: "partner" }>,
): ActivityState {
  const rest = (state.partners ?? []).filter((p) => !sameWork(p, event));
  if (event.what === "done") return { ...state, partners: rest };
  const { runId, handoff, device, team, who, replacing, onSite } = event;
  return {
    ...state,
    partners: [...rest, { runId, handoff, device, team, who, replacing, onSite }],
  };
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
        ...state,
        workers: state.workers.map((w) => (w.runId === event.runId ? called(w, event, now) : w)),
      };
    case "partner":
      return partnered(state, event);
    case "end":
      return {
        workers: state.workers.filter((w) => w.runId !== event.runId),
        partners: (state.partners ?? []).filter((p) => p.runId !== event.runId),
      };
  }
}

/** Parse the data of one activity event; undefined when it is not one. */
export function parseActivity(data: string): ActivityEvent | undefined {
  try {
    const event = JSON.parse(data) as ActivityEvent;
    return event && ["start", "call", "partner", "end"].includes(event.type) ? event : undefined;
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

/** Runs that look the same in the list: one line with how many there are ("운영 (규칙 기반) ×5"). */
export interface WorkerGroup {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly doing: string;
  /** Where the run named last (the group's first one that named a place). */
  readonly target?: string;
  readonly count: number;
  /** The run a press on the line takes the camera to: the latest one that named a place. */
  readonly pick?: string;
  readonly idle: boolean;
  /** The colour of the first run of the group. */
  readonly hue: number;
}

/** "에이전트 5개가 일하는 중": what the collapsed chip says. */
export const workersLine = (count: number): string => `에이전트 ${count}개가 일하는 중`;

/**
 * Identical agents (the same name, harness, experiment, last act and place) are one line with a count, the latest
 * first. `place` names the equipment a run is at.
 */
export function groupWorkers(
  workers: readonly Worker[],
  now: number,
  place: (id: string) => string | undefined,
): WorkerGroup[] {
  const groups = new Map<string, WorkerGroup>();
  for (const w of [...workers].sort((a, b) => b.lastAt - a.lastAt)) {
    const name = nameOf(w.who);
    const doing = doingOf(w);
    const target = w.at ? place(w.at) : undefined;
    const idle = isIdle(w, now);
    const key = [name.title, name.detail, doing, target ?? "", idle].join("|");
    const found = groups.get(key);
    if (found)
      groups.set(key, {
        ...found,
        count: found.count + 1,
        ...(found.pick || !w.at ? {} : { pick: w.runId }),
      });
    else
      groups.set(key, {
        key,
        title: name.title,
        detail: name.detail,
        doing,
        ...(target ? { target } : {}),
        count: 1,
        ...(w.at ? { pick: w.runId } : {}),
        idle,
        hue: w.hue,
      });
  }
  return [...groups.values()];
}
