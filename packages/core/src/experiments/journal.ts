/**
 * What an operation run keeps beside its record while it goes (ADR-0094 item 8, ADR-0112): enough to build the
 * session again after the server restarts. The session's own inputs (`SessionInput`) are the heart of it; around them
 * the host notes which world the run was on, when each call was seen on the wall clock and the links it lost and got back.
 */
import type { SessionInput } from "@terrarium/core/session";

/** The agent's connection, as the host noted it (`resumed`: the server stopped and the run was picked up again). */
export interface LinkNote {
  readonly what: "lost" | "back" | "resumed";
  /** World time of the newest thing the host had seen. */
  readonly t: number;
  readonly reason?: string;
  /** For `resumed`: real seconds the run stood still. */
  readonly gapSeconds?: number;
}

export type JournalEntry =
  | SessionInput
  /** Head: the world version and the engine version the run was recorded on. */
  | readonly ["h", string, string]
  /** A call seen on the wall clock: world time, tool, real time. */
  | readonly ["k", number, string, string]
  | readonly ["l", LinkNote];

/** The entries of a run in order, and the real time the last of them was written at. */
export interface Journal {
  readonly entries: readonly JournalEntry[];
  readonly lastAt?: string;
}

/** The entries of a journal sorted by what they are. */
export interface JournalParts {
  readonly head?: readonly [string, string];
  readonly inputs: SessionInput[];
  readonly stamps: Array<{ readonly t: number; readonly tool: string; readonly real: string }>;
  readonly links: LinkNote[];
}

export function partsOf(journal: Journal): JournalParts {
  let head: readonly [string, string] | undefined;
  const inputs: SessionInput[] = [];
  const stamps: JournalParts["stamps"] = [];
  const links: LinkNote[] = [];
  for (const e of journal.entries) {
    if (e[0] === "h") head = [e[1], e[2]];
    else if (e[0] === "k") stamps.push({ t: e[1], tool: e[2], real: e[3] });
    else if (e[0] === "l") links.push(e[1]);
    else inputs.push(e);
  }
  return { ...(head ? { head } : {}), inputs, stamps, links };
}
