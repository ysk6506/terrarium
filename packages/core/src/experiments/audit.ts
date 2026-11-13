/**
 * The audit log's records and the port that keeps them (ADR-0193, permissions.md section 6). One entry says who did what to
 * what, when, and how it ended. The words an entry may use are closed lists, so a screen can show every one and a
 * test can walk them all; nothing in an entry is free text but a display name, and no value of a secret or of the content of a
 * record can fit in one.
 *
 * Entries are only ever added. The one removal is the retention sweep (`sweep`), which takes entries older than a cut-off.
 */
import type { Scope } from "./scope";

export const AUDIT_OUTCOMES = ["allowed", "denied", "failed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Why an entry is `denied` or `failed`. An `allowed` entry has none. Each denial kind has its own word, so none hides in another. */
export const AUDIT_REASONS = [
  // denied
  "unauthenticated",
  "proxy_secret_missing",
  "proxy_secret_wrong",
  "proxy_login_missing",
  "not_admin",
  "not_owner",
  "not_allowed",
  "not_visible",
  // failed
  "invalid_input",
  "not_found",
  "conflict",
  "unavailable",
  "error",
] as const;
export type AuditReason = (typeof AUDIT_REASONS)[number];

/** What was done, by name. A new thing a person can do is a new word here first (a test walks every route). */
export const AUDIT_ACTIONS = [
  "auth.sign_in",
  "access.denied",
  "world.create",
  "world.generate",
  // Kept so that entries written before ADR-0202 still read: the import route is gone.
  "world.import",
  "world.update",
  "world.physics_update",
  "world.delete",
  "world.like",
  "world.unlike",
  "world.read",
  "scenario.create",
  "scenario.update",
  "scenario.delete",
  "scenario.calibrate",
  "scenario.process_update",
  "scenario.read",
  "experiment.start",
  "experiment.fork",
  "experiment.add_runs",
  "experiment.cancel",
  "experiment.read",
  "run.escalation_answer",
  "run.read",
  "share.create",
  "share.revoke",
  "share.list",
  "connection.create",
  "connection.update",
  "connection.delete",
  "connection.try",
  "connection.check",
  "connection.keep",
  "connection.agent_version_add",
  "connection.agent_version_update",
  "connection.agent_version_delete",
  "connection.read",
  "model.create",
  "model.update",
  "model.delete",
  "model.check",
  "model.set_default",
  "model.read",
  "preset.save",
  "preset.import",
  "preset.rename",
  "preset.delete",
  "preset.restore",
  "service_card.create",
  "service_card.update",
  "service_card.copy",
  "service_card.delete",
  "scope.change",
  "audit.read",
  "audit.export",
  "audit.read_own",
  "audit.sweep",
  "audit.limit",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Who did it: a person, or the server itself (the retention sweep and the limit line). */
export const SUBJECT_KINDS = ["person", "system"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/**
 * The fields whose values an entry may hold, before and after a change. Everything else changes only by name: a value that
 * could be a secret or the content of a record has no place in the log.
 */
export const VALUE_FIELDS = ["scope", "group", "role", "owner", "sharing"] as const;
export type ValueField = (typeof VALUE_FIELDS)[number];

const RESOURCE_KINDS = new Set<string>([
  "world",
  "scenario",
  "experiment",
  "run",
  "connection",
  "model",
  "preset",
  "service_card",
  "audit",
  "session",
]);

/**
 * The kinds of thing an entry can be about. Open on purpose: the column is plain text, so workflows, cases and approvals
 * join by registering their word (`registerResourceKind`) and need no migration. An entry about an unregistered kind is refused.
 */
export const isResourceKind = (kind: string): boolean => RESOURCE_KINDS.has(kind);
export function registerResourceKind(kind: string): void {
  if (!/^[a-z][a-z_]{1,39}$/.test(kind)) throw new Error(`종류 이름이 올바르지 않아요: ${kind}`);
  RESOURCE_KINDS.add(kind);
}
export const resourceKinds = (): readonly string[] => [...RESOURCE_KINDS];

export interface AuditSubject {
  readonly kind: SubjectKind;
  /** The login id for a person; the agent's id for an agent. */
  readonly id: string;
  /** The name as it was at that moment. */
  readonly name: string;
  /** How the identity was established (proxy, sso, self, anonymous); left out for an agent or the server. */
  readonly source?: string;
  readonly admin: boolean;
}

/** What the entry is about, as it stood at that moment. */
export interface AuditResource {
  readonly kind: string;
  readonly id?: string;
  readonly name?: string;
  readonly owner?: string;
  readonly scope?: Scope;
  readonly group?: string;
}

export interface ValueChange {
  readonly field: ValueField;
  readonly before: string | null;
  readonly after: string | null;
}

export interface AuditEntry {
  /** Order of writing, from 1; the cursor of a listing. */
  readonly seq: number;
  /** When, by the server's clock (ISO 8601). */
  readonly at: string;
  /** Ties together the entries one request wrote. */
  readonly requestId: string;
  readonly subject: AuditSubject;
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly reason?: AuditReason;
  /** The contract route that was called, when a route led to this. */
  readonly route?: string;
  readonly resource: AuditResource;
  /** The names (never the values) of the fields a change sent. */
  readonly fields?: readonly string[];
  readonly changes?: readonly ValueChange[];
  /** Where a failed sign-in came from. Only those entries have it. */
  readonly remoteAddress?: string;
  /** Small counts and times: how many a list held, how many a sweep removed. */
  readonly detail?: Readonly<Record<string, string | number>>;
}

export type NewAuditEntry = Omit<AuditEntry, "seq" | "at">;

export interface AuditFilter {
  /** Entries at or after this time, and before it (ISO 8601). */
  readonly from?: string;
  readonly to?: string;
  /** The login id (or agent id) that did it. */
  readonly subject?: string;
  readonly action?: AuditAction;
  readonly resourceKind?: string;
  readonly resourceId?: string;
  readonly outcome?: AuditOutcome;
  /** Entries about things this person owns. */
  readonly owner?: string;
  readonly limit: number;
  /** Entries older than this sequence number: the cursor a listing hands back. */
  readonly before?: number;
}

export interface AuditPage {
  /** Newest first. */
  readonly entries: readonly AuditEntry[];
  /** Pass as `before` for the next page; absent on the last. */
  readonly next?: number;
}

/**
 * The audit log's store. It is a port of its own, apart from `ExperimentStore`: the experiment side is handed an
 * `ExperimentStore` and so cannot write here, and only the recorder is handed this.
 */
export interface AuditStore {
  /** Add one entry. The only way in. */
  append(at: string, entry: NewAuditEntry): Promise<AuditEntry>;
  /** Succeeds when a write would, now; throws when it would not. Asked before a change is made. */
  ready(): Promise<void>;
  /** Newest first. */
  query(filter: AuditFilter): Promise<AuditPage>;
  /** Remove the entries written before `cutoff` (ISO 8601). The only removal there is. Returns how many. */
  sweep(cutoff: string): Promise<number>;
}

/** Does the entry pass the filter? (The memory store applies it; SQL applies the same rule in its WHERE clause.) */
export function auditMatches(e: AuditEntry, f: AuditFilter): boolean {
  // a filter that is not given holds for every entry; each given one must hold
  const holds = <T>(given: T | undefined, test: (v: T) => boolean): boolean =>
    given === undefined || test(given);
  return (
    holds(f.from, (v) => e.at >= v) &&
    holds(f.to, (v) => e.at < v) &&
    holds(f.subject, (v) => e.subject.id === v) &&
    holds(f.action, (v) => e.action === v) &&
    holds(f.resourceKind, (v) => e.resource.kind === v) &&
    holds(f.resourceId, (v) => e.resource.id === v) &&
    holds(f.outcome, (v) => e.outcome === v) &&
    holds(f.owner, (v) => e.resource.owner === v) &&
    holds(f.before, (v) => e.seq < v)
  );
}

/** A page of at most `limit` entries from newest-first matches; `next` is set when more remain. */
export function pageOf(matches: readonly AuditEntry[], limit: number): AuditPage {
  const entries = matches.slice(0, limit);
  const last = entries[entries.length - 1];
  return matches.length > limit && last ? { entries, next: last.seq } : { entries };
}
