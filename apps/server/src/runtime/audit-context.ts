/**
 * What the decisions made during one request tell the audit log (ADR-0193). The places that decide (`may`, `allow`, `mustSee`,
 * the gate, `changeScope`) leave a short note here as they decide; the one recorder at the edge of the request reads the
 * notes when the request ends and writes the entries. So a decision is recorded where it is made, and no handler writes an
 * audit line of its own.
 *
 * A note holds only what an entry may hold: a kind, an id the server looked up, a display name, an owner and a scope. A
 * request that runs outside this context (a test of a service, the scheduler) notes nothing.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditReason, Scope, ValueChange } from "@terrarium/core/experiments";

/** A thing the server looked up, with what the entry says about it. */
export interface Ref {
  readonly kind: string;
  readonly id: string;
  readonly name?: string | undefined;
}

export interface Standing {
  readonly owner?: string | undefined;
  readonly scope?: Scope | undefined;
  readonly group?: string | undefined;
}

export type Noted = Ref & Standing;

export interface Denial {
  readonly reason: AuditReason;
  /** What was refused, when the decision knew which record it was about. */
  readonly ref?: Noted;
  /** Who owns it, when the decision was made on a bare resource. */
  readonly standing?: Standing;
}

export interface Notes {
  /** Records the request found and was allowed to see, by `kind:id`. */
  readonly found: Map<string, Noted>;
  /** Records an administrator was allowed to see only because they are one. */
  readonly overrides: Noted[];
  denial?: Denial;
  readonly changes: ValueChange[];
  /** The owner of whatever the last decision of the request was about. */
  owner?: string | undefined;
  /** Set when the request is done; late notes (a stream, a scheduler continuing) are ignored. */
  closed: boolean;
}

const context = new AsyncLocalStorage<Notes>();

export const newNotes = (): Notes => ({
  found: new Map(),
  overrides: [],
  changes: [],
  closed: false,
});

/** Run `fn` with `notes` collecting what its decisions say. */
export const withNotes = <T>(notes: Notes, fn: () => T): T => context.run(notes, fn);

const open = (): Notes | undefined => {
  const notes = context.getStore();
  return notes && !notes.closed ? notes : undefined;
};

export const keyOf = (ref: Ref): string => `${ref.kind}:${ref.id}`;

/** The request looked this record up and the person may see it. */
export function noteFound(ref: Noted, byRole: boolean): void {
  const notes = open();
  if (!notes) return;
  notes.found.set(keyOf(ref), ref);
  if (
    byRole &&
    notes.overrides.length < 20 &&
    !notes.overrides.some((o) => keyOf(o) === keyOf(ref))
  )
    notes.overrides.push(ref);
}

/** A decision refused the request. The first refusal is the one that stopped it. */
export function noteDenial(denial: Denial): void {
  const notes = open();
  if (notes && !notes.denial) notes.denial = denial;
}

/** A field whose before and after values the entry may hold changed. */
export function noteChange(change: ValueChange): void {
  open()?.changes.push(change);
}

export function noteOwner(owner: string | undefined): void {
  const notes = open();
  if (notes && owner !== undefined) notes.owner = owner;
}
