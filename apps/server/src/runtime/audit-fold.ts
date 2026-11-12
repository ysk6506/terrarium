/**
 * Failures before a person is known (ADR-0193): anyone can make them, so they must not be able to fill the log. A change is
 * refused when the log cannot be written, which makes a full disk a lever on every change. So these failures are folded:
 * one line for each (remote address, reason) in a minute, carrying how many there were in that minute (`count`), and no more
 * than a set number of such lines for all of them together in a minute. What is folded or over the limit is only counted
 * (`terrarium_audit_suppressed_total`), and one line says the limit was reached.
 */
import type { AuditReason, NewAuditEntry } from "@terrarium/core/experiments";

const MINUTE_MS = 60_000;

export const PRE_AUTH_REASONS: readonly AuditReason[] = [
  "unauthenticated",
  "proxy_secret_missing",
  "proxy_secret_wrong",
  "proxy_login_missing",
];

export const isPreAuth = (e: NewAuditEntry): boolean =>
  e.action === "auth.sign_in" && e.reason !== undefined && PRE_AUTH_REASONS.includes(e.reason);

/** What a minute that has ended leaves to be written. */
export interface ClosedMinute {
  readonly lines: readonly NewAuditEntry[];
  /** Failures beyond the limit: not written, said once in the line that tells the limit was reached. */
  readonly over: number;
  readonly windowStart: string;
}

export class PreAuthFold {
  private window = -1;
  private readonly lines = new Map<string, { entry: NewAuditEntry; count: number }>();
  private over = 0;

  constructor(private readonly limit: number) {}

  private static minuteOf(at: string): number {
    return Math.floor(Date.parse(at) / MINUTE_MS);
  }

  /** The minute that is open has ended by `at`: take it out. */
  closeIfEnded(at: string, force = false): ClosedMinute | undefined {
    if (this.window < 0) return undefined;
    if (!force && PreAuthFold.minuteOf(at) <= this.window) return undefined;
    const closed: ClosedMinute = {
      lines: [...this.lines.values()].map(({ entry, count }) => ({
        ...entry,
        detail: { count, windowStart: new Date(this.window * MINUTE_MS).toISOString() },
      })),
      over: this.over,
      windowStart: new Date(this.window * MINUTE_MS).toISOString(),
    };
    this.window = -1;
    this.lines.clear();
    this.over = 0;
    return closed;
  }

  /** Take one failure in. Returns true when it will have a line of its own in this minute, false when it is only counted. */
  add(entry: NewAuditEntry, at: string): boolean {
    if (this.window < 0) this.window = PreAuthFold.minuteOf(at);
    const key = `${entry.remoteAddress ?? "-"}|${entry.reason}`;
    const held = this.lines.get(key);
    if (held) {
      held.count += 1;
      return false;
    }
    if (this.lines.size >= this.limit) {
      this.over += 1;
      return false;
    }
    this.lines.set(key, { entry, count: 1 });
    return true;
  }
}
