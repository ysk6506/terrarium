/**
 * Run lifecycle (REQ-030): queued → running → completed | failed | cancelled. Finished runs never
 * change again, so a result once shown stays true. An experiment's status follows from its runs.
 */
import { ConflictError } from "@terrarium/core/kernel";
import type { RunResult } from "@terrarium/core/session";
import type { ExperimentStatus, HarnessRunInfo, RunRecord, RunStatus } from "./model";

export type RunEvent =
  | { readonly type: "start"; readonly at: string }
  | {
      readonly type: "complete";
      readonly at: string;
      readonly result: RunResult;
      readonly harness?: HarnessRunInfo;
    }
  | {
      readonly type: "fail";
      readonly at: string;
      readonly error: string;
      readonly harness?: HarnessRunInfo;
    }
  | { readonly type: "cancel"; readonly at: string };

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled"]);
const ALLOWED: Readonly<Record<RunEvent["type"], readonly RunStatus[]>> = {
  start: ["queued"],
  complete: ["running"],
  fail: ["queued", "running"],
  cancel: ["queued", "running"],
};

export const isTerminal = (status: RunStatus): boolean => TERMINAL.has(status);

export function newRun(
  id: string,
  experimentId: string,
  index: number,
  seed: number,
  at: string,
  repeat = 1,
): RunRecord {
  return { id, experimentId, index, seed, repeat, status: "queued", queuedAt: at };
}

export function applyRunEvent(run: RunRecord, event: RunEvent): RunRecord {
  if (!ALLOWED[event.type].includes(run.status))
    throw new ConflictError(`run ${run.id} is ${run.status}; it cannot ${event.type}`);
  switch (event.type) {
    case "start":
      return { ...run, status: "running", startedAt: event.at };
    case "complete":
      return {
        ...run,
        status: "completed",
        finishedAt: event.at,
        result: event.result,
        ...(event.harness ? { harness: event.harness } : {}),
      };
    case "fail":
      return {
        ...run,
        status: "failed",
        finishedAt: event.at,
        error: event.error,
        ...(event.harness ? { harness: event.harness } : {}),
      };
    case "cancel":
      return { ...run, status: "cancelled", finishedAt: event.at };
  }
}

export interface Progress {
  readonly total: number;
  readonly finished: number;
  readonly completed: number;
  readonly passed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly running: number;
}

export function progressOf(runs: readonly RunRecord[]): Progress {
  const count = (s: RunStatus) => runs.filter((r) => r.status === s).length;
  return {
    total: runs.length,
    finished: runs.filter((r) => isTerminal(r.status)).length,
    completed: count("completed"),
    passed: runs.filter((r) => r.result?.score.passed).length,
    failed: count("failed"),
    cancelled: count("cancelled"),
    running: count("running"),
  };
}

/**
 * Queued until something starts; running while anything is left. Once every run is over a stopped run decides: the
 * experiment reads "cancelled" (멈춤) if a person stopped any of it, since it did not run what it planned (ADR-0163);
 * otherwise "completed" if any run completed, and "failed" if none did.
 */
export function experimentStatus(runs: readonly RunRecord[]): ExperimentStatus {
  const p = progressOf(runs);
  if (p.total === 0 || (p.finished === 0 && p.running === 0)) return "queued";
  if (p.finished < p.total) return "running";
  if (p.cancelled > 0) return "cancelled";
  return p.completed > 0 ? "completed" : "failed";
}
