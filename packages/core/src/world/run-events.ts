/**
 * The record of one run as an append-only list of events (REQ-083, ADR-0088 item 1): what the agent called,
 * what happened in the world, and how the run was closed and graded. Nothing in it is ever changed after it is
 * written; replay (the topology time bar), the result's first line and training data all read this one list.
 *
 * Every event has two clocks: `t` is the world's (simulated seconds since the world began, the axis
 * `TimelineEntry.t` and `ToolCallRecord.t` are on), `real` is the wall clock (ISO) when the host knew it.
 * A tool call carries the real time of the call itself; a world event carries the real time of the last call
 * made before it (the host never sees inside a simulated step), so for those it is an upper bound, not a
 * stopwatch.
 */
import type { WorldCommand } from "./world";

/** What a tool call does to the world: it only looks, changes something, lets time pass, or hands in the answer. */
export type ToolEffect = "observe" | "act" | "wait" | "answer";

/** The format changes only by adding fields; a reader ignores what it does not know. */
export const RUN_EVENT_FORMAT = 1;

interface Stamp {
  /** Position in the run's list, from 0, in the order the events are written. */
  readonly seq: number;
  /** World time, simulated seconds. */
  readonly t: number;
  /** Wall-clock time (ISO 8601), when known. */
  readonly real?: string;
}

/** One tool call by the agent. */
export interface ToolEvent extends Stamp {
  readonly kind: "tool";
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly ok: boolean;
  readonly error?: string;
  readonly effect: ToolEffect;
  /** The equipment the call names (ids), in the order it names them. */
  readonly targets: readonly string[];
  /** What came of it in a few words: what it changed, or why it failed; empty for a plain look. */
  readonly summary: string;
}

/** Something that happened in the world: a fault, an alarm, a switch flipped. `cause` tells who did it. */
export interface WorldRunEvent extends Stamp {
  readonly kind: "world";
  readonly cause: string;
  readonly command: WorldCommand;
}

/** The run's own milestones: the task is handed over, the run is closed, the score is given. */
export type ScoreEvent = Stamp &
  (
    | {
        readonly kind: "score";
        readonly what: "agent_start";
        /** The world time the run is counted from: the scenario's first step (before it the world only warms up). */
        readonly scenarioStart: number;
      }
    | {
        readonly kind: "score";
        readonly what: "closed";
        /** Why it ended (an `EndReason`). */
        readonly reason: string;
        readonly diagnosed: boolean;
      }
    | {
        readonly kind: "score";
        readonly what: "graded";
        readonly total: number | null;
        readonly passed: boolean;
        /** The equipment the scenario's answer names; the first line says whether the agent pointed at one. */
        readonly rootCause: readonly string[];
      }
  );

export type RunEvent = ToolEvent | WorldRunEvent | ScoreEvent;
