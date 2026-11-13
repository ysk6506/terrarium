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
import type { Domain } from "./domains";
import type { WorkKind } from "./lead-times";
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
  /** Set when the action gate stopped the call before it reached the tool (REQ-123): the world was not touched. */
  readonly blockedBy?: "view";
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

/** One of the agent's last calls, as the person who is asked for help sees it. */
export interface RecentCall {
  readonly tool: string;
  readonly ok: boolean;
  readonly summary: string;
}

/**
 * The person on the other end of `ask_human` (ADR-0087 item 4): the agent's request, what the person did while the run
 * waited, and how the answer went back. The wall-clock wait is `waitedSeconds` on the answer.
 */
export type HumanEvent = Stamp &
  (
    | {
        readonly kind: "human";
        readonly what: "asked";
        readonly request: string;
        /** The agent's last calls, newest last: what the person sees to understand the request. */
        readonly recent: readonly RecentCall[];
      }
    | {
        readonly kind: "human";
        readonly what: "acted";
        readonly tool: string;
        readonly args: Readonly<Record<string, unknown>>;
        readonly ok: boolean;
        readonly summary: string;
      }
    | {
        readonly kind: "human";
        readonly what: "answered";
        /** Who answered: a person, the setup's fixed reply, or nobody (the run was ended). */
        readonly by: "human" | "auto" | "none";
        readonly answer: "reply" | "acted" | "more_tools" | "end";
        readonly reply?: string;
        readonly tools?: readonly string[];
        readonly waitedSeconds: number;
      }
  );

/** One fault handed to a team, and when it is gone (REQ-093, ADR-0100). Times are world seconds. */
export interface HandedFault {
  readonly faultId: string;
  readonly faultType: string;
  readonly target: string;
  /** How long after the hand-off it is gone, in ten-minute steps; it is gone exactly then. */
  readonly etaSeconds: number;
  readonly doneAt: number;
  /** When the last stretch begins: someone arrives on site, or starts at the console. */
  readonly startsAt: number;
  readonly kind: WorkKind;
  /** Whether a person comes to the equipment (a part is changed, a breaker is reset). */
  readonly onSite: boolean;
  /** The team itself, or the vendor it calls. */
  readonly who: "team" | "vendor";
}

/**
 * What the other side does with a hand-off, in the order it happens: `handed` (the agent gave the domain over, with
 * the faults it had then), `started` (the last stretch of the wait begins: an engineer is on site or at the console)
 * and `done` (the fault is gone). They are the events `events_since` shows the agent and the topology time bar marks.
 */
export type CounterpartEvent = Stamp & {
  readonly kind: "counterpart";
  readonly handoff: string;
  readonly domain: Domain;
  /** "서버 팀", or the vendor's name when it is the vendor who works. */
  readonly team: string;
  readonly summary: string;
} & (
    | { readonly what: "handed"; readonly note?: string; readonly faults: readonly HandedFault[] }
    | { readonly what: "started" | "done"; readonly fault: HandedFault }
  );

export type TicketStatus = "mine" | "waiting" | "done";

export interface TicketSnapshot {
  readonly id: string;
  readonly title: string;
  readonly status: TicketStatus;
  /** Whom the agent waits for (status waiting). */
  readonly waitingFor?: string;
  /** World time by which it is due, or by which the other side will have finished. */
  readonly dueAt?: number;
  readonly note?: string;
  /** The hand-off it was made for. */
  readonly handoff?: string;
}

/** The agent's work tickets, written when one is made or changed (the board reads the latest of each). */
export interface TicketEvent extends Stamp {
  readonly kind: "ticket";
  readonly what: "created" | "updated";
  readonly ticket: TicketSnapshot;
  /** Whether the system made or moved it (a hand-off, a finished hand-off) and not the agent. */
  readonly auto: boolean;
}

/**
 * The agent's connection to the harness, in an operation (ADR-0094 item 8): it was lost (the harness stopped or failed
 * while the hours were not used up) and it came back (the executor reached the harness again and the agent went on); or
 * the whole server stopped and the run was built again from its journal (`resumed`).
 * The host writes it; the session's own record of the world is not touched.
 */
export interface LinkEvent extends Stamp {
  readonly kind: "link";
  readonly what: "lost" | "back" | "resumed";
  /** Why, in a few words (the harness's own message). */
  readonly reason?: string;
  /** For `resumed` (the server stopped and the run was picked up again): the real seconds it stood still. */
  readonly gapSeconds?: number;
}

/**
 * A call hit something the real tool can do and the proving ground cannot (ADR-0184). One event per gap, written right
 * after the tool event of the call. `tool` and `feature` are stable keys from fixed tables (`awk`, `printf-%c`), never
 * text the agent typed, so the record carries no command, file name or row.
 */
export interface GapEvent extends Stamp {
  readonly kind: "gap";
  readonly tool: string;
  readonly feature: string;
  /** The `seq` of the tool event this gap belongs to. */
  readonly call: number;
}

export type RunEvent =
  | ToolEvent
  | GapEvent
  | WorldRunEvent
  | ScoreEvent
  | HumanEvent
  | CounterpartEvent
  | TicketEvent
  | LinkEvent;
