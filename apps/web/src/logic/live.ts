/**
 * Live progress of an experiment (REQ-030): server-sent events folded into what the page shows. Runs
 * update in place; tool calls feed a short "now" ticker per running run.
 */
import type { ExperimentEvent, ExperimentSummary, RunSummary } from "@terrarium/core/contract";

export interface LiveCall {
  readonly t: number;
  readonly tool: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface LiveState {
  readonly summary?: ExperimentSummary;
  readonly runs: readonly RunSummary[];
  /** The latest calls of each run, newest last. */
  readonly calls: Readonly<Record<string, readonly LiveCall[]>>;
  /** Something changed that the full view should be fetched again for (a run finished). */
  readonly stale: boolean;
}

export const MAX_LIVE_CALLS = 8;

export function initialLive(runs: readonly RunSummary[], summary?: ExperimentSummary): LiveState {
  return { runs, calls: {}, stale: false, ...(summary ? { summary } : {}) };
}

export function applyEvent(state: LiveState, event: ExperimentEvent): LiveState {
  switch (event.type) {
    case "experiment": {
      // runs that finished before this stream was open send no run event: a summary that is further along than the
      // page's own says the full view is old
      const known = state.summary?.progress?.finished ?? 0;
      const behind = known < (event.summary.progress?.finished ?? 0);
      return { ...state, summary: event.summary, stale: state.stale || behind };
    }
    case "run": {
      const known = state.runs.some((r) => r.id === event.run.id);
      const runs = known
        ? state.runs.map((r) => (r.id === event.run.id ? { ...r, ...event.run } : r))
        : [...state.runs, event.run].sort((a, b) => a.index - b.index);
      const finished = ["completed", "failed", "cancelled"].includes(event.run.status);
      return { ...state, runs, stale: state.stale || finished };
    }
    case "call": {
      const previous = state.calls[event.runId] ?? [];
      const call: LiveCall = {
        t: event.t,
        tool: event.tool,
        ok: event.ok,
        ...(event.error ? { error: event.error } : {}),
      };
      return {
        ...state,
        calls: { ...state.calls, [event.runId]: [...previous, call].slice(-MAX_LIVE_CALLS) },
      };
    }
  }
}

/** Parse one server-sent event block ("event: x\ndata: {...}"). */
export function parseEvent(block: string): ExperimentEvent | undefined {
  const data = block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("\n");
  if (!data) return undefined;
  try {
    return JSON.parse(data) as ExperimentEvent;
  } catch {
    return undefined;
  }
}
