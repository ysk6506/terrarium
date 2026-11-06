/**
 * What an operation session was given, in order (REQ-090, ADR-0094 item 8, ADR-0112): the times the host synced it to
 * the clock, the agent's calls and what a person did. A session never reads the clock and starts from a seed, so
 * playing these into a fresh session brings it to the state it had: a restarted server picks an operation up from here.
 */
import type { HumanResolution } from "../human";

/** One thing a session was given. Tuples keep a day of syncs small. */
export type SessionInput =
  /** `sync(elapsed)`: seconds since the agent's task began. */
  | readonly ["s", number]
  /** `call(tool, args)` by the agent. */
  | readonly ["c", string, Record<string, unknown>]
  /** A person's change to the world while the run waited. */
  | readonly ["a", string, Record<string, unknown>]
  /** A person's answer to the call that waited. */
  | readonly ["r", HumanResolution];

/** The part of a session that inputs are played into. */
export interface InputTarget {
  sync(elapsedSeconds: number): unknown;
  call(tool: string, args: Record<string, unknown>): unknown;
  humanAct(tool: string, args: Record<string, unknown>): unknown;
  resolveHuman(resolution: HumanResolution): unknown;
}

/** Play the inputs into a session that has just started, in the order they came. Returns the last sync time. */
export function replayInputs(target: InputTarget, inputs: Iterable<SessionInput>): number {
  let elapsed = 0;
  for (const input of inputs) {
    switch (input[0]) {
      case "s":
        target.sync(input[1]);
        elapsed = input[1];
        break;
      case "c":
        target.call(input[1], input[2]);
        break;
      case "a":
        target.humanAct(input[1], input[2]);
        break;
      default:
        target.resolveHuman(input[1]);
    }
  }
  return elapsed;
}
