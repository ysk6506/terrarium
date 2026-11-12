/**
 * The recorder: the one writer of the audit log (ADR-0193, permissions.md section 6). It is handed the audit store and nothing else
 * is, so no other code can add an entry; and it is handed no way to change or remove one, except the retention sweep.
 *
 * It takes the time from the clock it was given (the platform's own stamps), never from the wall, and it checks every entry
 * against the closed lists before it is stored: an action or a reason outside them, a kind nobody registered, a field name
 * or a value outside what an entry may hold. A secret has no field to ride in.
 */
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_REASONS,
  type AuditEntry,
  type AuditStore,
  isResourceKind,
  type NewAuditEntry,
  VALUE_FIELDS,
} from "@terrarium/core/experiments";
import { randomToken, TerrariumError } from "@terrarium/core/kernel";

const DAY_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 120;
const VALUE_MAX = 100;
const FIELDS_MAX = 20;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** The server itself, as the one who sweeps. */
const SYSTEM = { kind: "system", id: "retention", name: "서버", admin: false } as const;

/** The audit entry could not be written. A change that needed it is refused (or says so if it was already made). */
export class AuditWriteError extends TerrariumError {
  override readonly code = "audit_unavailable";
  override readonly status = 503;
}

export const NOT_DONE =
  "감사 기록을 남길 수 없어서 이 일을 하지 않았어요. 잠시 뒤에 다시 해 보시고, 계속되면 관리자에게 알려 주세요";
export const DONE_UNRECORDED = "일은 끝났지만 감사 기록을 남기지 못했어요. 관리자에게 알려 주세요";

/** What the log may say in a line of the server's own log: the action and how it ended, nothing from the entry. */
export type AuditLogLine = (line: { readonly action: string; readonly outcome: string }) => void;

export interface AuditCounts {
  /** Entries written, by `action|outcome`. */
  readonly entries: ReadonlyMap<string, number>;
  /** Writes that failed. */
  readonly failures: number;
}

/** Plain text with no control characters, cut to length. */
const clip = (text: string, max: number): string =>
  text
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, max);

/** The entry, checked and cleaned. Throws for a word outside the closed lists: that is a mistake in the code, caught by tests. */
export function cleaned(input: NewAuditEntry): NewAuditEntry {
  const { action, outcome, reason, resource, subject } = input;
  if (!(AUDIT_ACTIONS as readonly string[]).includes(action))
    throw new Error(`감사 행동 '${action}'을 몰라요`);
  if (!(AUDIT_OUTCOMES as readonly string[]).includes(outcome))
    throw new Error(`감사 결과 '${outcome}'를 몰라요`);
  if ((outcome === "allowed") !== (reason === undefined))
    throw new Error("막히거나 실패한 기록에만 까닭이 있어요");
  if (reason !== undefined && !(AUDIT_REASONS as readonly string[]).includes(reason))
    throw new Error(`감사 까닭 '${reason}'을 몰라요`);
  if (!isResourceKind(resource.kind)) throw new Error(`감사 대상 종류 '${resource.kind}'를 몰라요`);
  const fields = input.fields?.filter((f) => FIELD_NAME.test(f)).slice(0, FIELDS_MAX);
  const changes = input.changes?.filter((c) =>
    (VALUE_FIELDS as readonly string[]).includes(c.field),
  );
  return {
    requestId: clip(input.requestId, 80),
    subject: {
      kind: subject.kind,
      id: clip(subject.id, NAME_MAX),
      name: clip(subject.name, NAME_MAX),
      ...(subject.source ? { source: subject.source } : {}),
      admin: subject.admin,
    },
    ...(input.onBehalfOf
      ? { onBehalfOf: { kind: "person", id: clip(input.onBehalfOf.id, NAME_MAX) } }
      : {}),
    ...(input.caseId ? { caseId: clip(input.caseId, 80) } : {}),
    action,
    outcome,
    ...(reason ? { reason } : {}),
    ...(input.route ? { route: clip(input.route, 60) } : {}),
    resource: {
      kind: resource.kind,
      ...(resource.id ? { id: clip(resource.id, NAME_MAX) } : {}),
      ...(resource.name ? { name: clip(resource.name, NAME_MAX) } : {}),
      ...(resource.owner ? { owner: clip(resource.owner, NAME_MAX) } : {}),
      ...(resource.scope ? { scope: resource.scope } : {}),
      ...(resource.group ? { group: clip(resource.group, NAME_MAX) } : {}),
    },
    ...(fields && fields.length > 0 ? { fields } : {}),
    ...(changes && changes.length > 0
      ? {
          changes: changes.map((c) => ({
            field: c.field,
            before: c.before === null ? null : clip(c.before, VALUE_MAX),
            after: c.after === null ? null : clip(c.after, VALUE_MAX),
          })),
        }
      : {}),
    ...(input.remoteAddress ? { remoteAddress: clip(input.remoteAddress, 64) } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

export class Auditor {
  private readonly entries = new Map<string, number>();
  private failures = 0;

  /**
   * `now` is the platform's clock; `line` receives the action and outcome of an entry that could not be written, for the
   * server's own log, so what the log holds stays out of the log.
   */
  constructor(
    private readonly store: AuditStore,
    private readonly now: () => string,
    private readonly line: AuditLogLine = () => undefined,
  ) {}

  counts(): AuditCounts {
    return { entries: new Map(this.entries), failures: this.failures };
  }

  /** Whether a write would work now: asked before a change is made, so that it can be refused instead of left unrecorded. */
  async ready(): Promise<void> {
    try {
      await this.store.ready();
    } catch {
      this.failures += 1;
      this.line({ action: "audit.ready", outcome: "failed" });
      throw new AuditWriteError(NOT_DONE);
    }
  }

  /** Write one entry; throws `AuditWriteError` when the store would not take it. */
  async record(input: NewAuditEntry): Promise<AuditEntry> {
    const entry = cleaned(input);
    try {
      const stored = await this.store.append(this.now(), entry);
      const key = `${entry.action}|${entry.outcome}`;
      this.entries.set(key, (this.entries.get(key) ?? 0) + 1);
      return stored;
    } catch {
      this.failures += 1;
      this.line({ action: entry.action, outcome: entry.outcome });
      throw new AuditWriteError(DONE_UNRECORDED);
    }
  }

  /** Write one entry and carry on if it cannot be written (a refusal, a read): the failure is counted and logged. */
  async tryRecord(input: NewAuditEntry): Promise<boolean> {
    try {
      await this.record(input);
      return true;
    } catch (err) {
      // a store that would not take it is counted already; an entry that was malformed is a mistake in the code, counted here
      if (!(err instanceof AuditWriteError)) {
        this.failures += 1;
        this.line({ action: input.action, outcome: input.outcome });
      }
      return false;
    }
  }

  /**
   * Remove the entries older than `days` and write an entry saying how many went. `days` of 0 keeps everything.
   * The only removal there is.
   */
  async sweep(days: number): Promise<number> {
    if (days <= 0) return 0;
    const cutoff = new Date(Date.parse(this.now()) - days * DAY_MS).toISOString();
    const removed = await this.store.sweep(cutoff);
    await this.tryRecord({
      requestId: `sweep-${randomToken(6)}`,
      subject: SYSTEM,
      action: "audit.sweep",
      outcome: "allowed",
      resource: { kind: "audit" },
      detail: { removed, olderThan: cutoff, retentionDays: days },
    });
    return removed;
  }
}
