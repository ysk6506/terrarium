/**
 * The clock driver (REQ-090, ADR-0094 item 2): how much world time passes for the real time that passed. A pure
 * function of the pace, a little memory and what is going on, so a test can read every rule.
 *
 *   실시간       1 second of world time per second of real time, always (the official score).
 *   빨리 감기    the chosen speed (10-60x) only while it is quiet; real speed for a while after an alarm goes up or a
 *               team does something, and while the agent is calling tools. An alarm that stays up for hours (a team
 *               is on its way) does not hold the clock at real speed: its first minutes are what tell the agent.
 */
import type { Pace } from "./config";

/** Real seconds to stay at real speed after the agent's last call: it is working, the world should not run away. */
export const CALL_HOLD_S = 2;
/** Real seconds to stay at real speed after an alarm or a team's event: the agent needs time to look. */
export const EVENT_HOLD_S = 300;

/** Why the clock runs at the speed it does. */
export type ClockReason = "realtime" | "quiet" | "alarm" | "event" | "call";

export interface ClockMemory {
  /** Real seconds (since the operation began) until which the clock stays at real speed. */
  readonly busyUntil: number;
  /** Why, for the result and the screen. */
  readonly busyBecause?: ClockReason;
}

export const START_CLOCK: ClockMemory = { busyUntil: 0 };

/** What is going on right now. */
export interface ClockSignals {
  /** Alarms raised since the last step. */
  readonly newAlarms: number;
  /** Events of the teams the agent handed work to, since the last step. */
  readonly newTeamEvents: number;
}

export interface ClockStep {
  /** World seconds to move on. */
  readonly worldSeconds: number;
  readonly speed: number;
  readonly reason: ClockReason;
  readonly memory: ClockMemory;
}

/** The agent made a call at real second `now`. */
export function noteCall(memory: ClockMemory, now: number): ClockMemory {
  const until = now + CALL_HOLD_S;
  return until > memory.busyUntil ? { busyUntil: until, busyBecause: "call" } : memory;
}

/** Move the clock by `realDt` real seconds, which end at real second `now` of the operation. */
export function clockStep(
  pace: Pace,
  memory: ClockMemory,
  now: number,
  realDt: number,
  signals: ClockSignals,
): ClockStep {
  const dt = Math.max(0, realDt);
  if (pace.mode === "realtime") return { worldSeconds: dt, speed: 1, reason: "realtime", memory };
  let next = memory;
  if (signals.newAlarms > 0) next = { busyUntil: now + EVENT_HOLD_S, busyBecause: "alarm" };
  else if (signals.newTeamEvents > 0)
    next = { busyUntil: now + EVENT_HOLD_S, busyBecause: "event" };
  if (now < next.busyUntil)
    return {
      worldSeconds: dt,
      speed: 1,
      reason: next.busyBecause ?? "event",
      memory: next,
    };
  return { worldSeconds: dt * pace.speed, speed: pace.speed, reason: "quiet", memory: next };
}
