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
import { type ClosedMinute, isPreAuth, PreAuthFold } from "./audit-fold";

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
  /** Failures before sign-in that got no line of their own (folded into another or over the limit), by reason. */
  readonly suppressed: ReadonlyMap<string, number>;
}

/** Plain text with no control characters, cut to length. */
const clip = (text: string, max: number): string =>
  text
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, max);

/** The words of an entry must be the closed lists' own: a mistake in the code is caught by tests, never stored. */
function checkWords(input: NewAuditEntry): void {
  const { action, outcome, reason, resource } = input;
  if (!(AUDIT_ACTIONS as readonly string[]).includes(action))
    throw new Error(`감사 행동 '${action}'을 몰라요`);
  if (!(AUDIT_OUTCOMES as readonly string[]).includes(outcome))
    throw new Error(`감사 결과 '${outcome}'를 몰라요`);
  if ((outcome === "allowed") !== (reason === undefined))
    throw new Error("막히거나 실패한 기록에만 까닭이 있어요");
  if (reason !== undefined && !(AUDIT_REASONS as readonly string[]).includes(reason))
    throw new Error(`감사 까닭 '${reason}'을 몰라요`);
  if (!isResourceKind(resource.kind)) throw new Error(`감사 대상 종류 '${resource.kind}'를 몰라요`);
}

const cleanResource = (r: NewAuditEntry["resource"]): NewAuditEntry["resource"] => ({
  kind: r.kind,
  ...(r.id ? { id: clip(r.id, NAME_MAX) } : {}),
  ...(r.name ? { name: clip(r.name, NAME_MAX) } : {}),
  ...(r.owner ? { owner: clip(r.owner, NAME_MAX) } : {}),
  ...(r.scope ? { scope: r.scope } : {}),
  ...(r.group ? { group: clip(r.group, NAME_MAX) } : {}),
});

const cleanSubject = (s: NewAuditEntry["subject"]): NewAuditEntry["subject"] => ({
  kind: s.kind,
  id: clip(s.id, NAME_MAX),
  name: clip(s.name, NAME_MAX),
  ...(s.source ? { source: s.source } : {}),
  admin: s.admin,
});

/** Only the fields whose values may be kept, and each value cut to length. */
function cleanChanges(changes: NewAuditEntry["changes"]): NonNullable<NewAuditEntry["changes"]> {
  const kept = (changes ?? []).filter((c) => (VALUE_FIELDS as readonly string[]).includes(c.field));
  const cut = (v: string | null) => (v === null ? null : clip(v, VALUE_MAX));
  return kept.map((c) => ({ field: c.field, before: cut(c.before), after: cut(c.after) }));
}

/** The entry, checked and cleaned. Throws for a word outside the closed lists. */
export function cleaned(input: NewAuditEntry): NewAuditEntry {
  checkWords(input);
  const fields = input.fields?.filter((f) => FIELD_NAME.test(f)).slice(0, FIELDS_MAX);
  const changes = cleanChanges(input.changes);
  return {
    requestId: clip(input.requestId, 80),
    subject: cleanSubject(input.subject),
    action: input.action,
    outcome: input.outcome,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.route ? { route: clip(input.route, 60) } : {}),
    resource: cleanResource(input.resource),
    ...(fields && fields.length > 0 ? { fields } : {}),
    ...(changes.length > 0 ? { changes } : {}),
    ...(input.remoteAddress ? { remoteAddress: clip(input.remoteAddress, 64) } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

export class Auditor {
  private readonly entries = new Map<string, number>();
  private failures = 0;
  private readonly suppressed = new Map<string, number>();
  private readonly fold: PreAuthFold;

  /**
   * `now` is the platform's clock; `line` receives the action and outcome of an entry that could not be written, for the
   * server's own log, so what the log holds stays out of the log.
   */
  constructor(
    private readonly store: AuditStore,
    private readonly now: () => string,
    private readonly line: AuditLogLine = () => undefined,
    preAuthLinesPerMinute = 60,
  ) {
    this.fold = new PreAuthFold(preAuthLinesPerMinute);
  }

  counts(): AuditCounts {
    return {
      entries: new Map(this.entries),
      failures: this.failures,
      suppressed: new Map(this.suppressed),
    };
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

  /**
   * Write one entry and carry on if it cannot be written (a refusal, a read): the failure is counted and logged.
   * A failure before sign-in is folded first (`audit-fold.ts`): it is written when its minute has ended.
   */
  async tryRecord(input: NewAuditEntry): Promise<boolean> {
    await this.flushDue();
    if (!isPreAuth(input)) return this.write(input);
    if (!this.fold.add(input, this.now())) {
      const reason = input.reason ?? "unknown";
      this.suppressed.set(reason, (this.suppressed.get(reason) ?? 0) + 1);
    }
    return true;
  }

  /** Write the lines of a minute of failures before sign-in that has ended (all of them when `force`, as when stopping). */
  async flushDue(force = false): Promise<void> {
    const closed = this.fold.closeIfEnded(this.now(), force);
    if (closed) await this.writeClosed(closed);
  }

  private async writeClosed(closed: ClosedMinute): Promise<void> {
    for (const line of closed.lines) {
      // the folded ones beyond the first of each line are counted as suppressed when they arrive; the first has its line
      await this.write(line);
    }
    if (closed.over > 0) {
      await this.write({
        requestId: `limit-${randomToken(6)}`,
        subject: SYSTEM,
        action: "audit.limit",
        outcome: "allowed",
        resource: { kind: "audit" },
        detail: {
          dropped: closed.over,
          lines: closed.lines.length,
          windowStart: closed.windowStart,
        },
      });
    }
  }

  private async write(input: NewAuditEntry): Promise<boolean> {
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
    await this.write({
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
