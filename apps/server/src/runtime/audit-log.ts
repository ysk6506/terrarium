/**
 * Reading the audit log (ADR-0193): the administrators' listing and file, and the limited view of what happened to a
 * person's own things. Reading never changes an entry; the recorder at the edge of the request writes that a read happened.
 */
import {
  AUDIT_EXPORT_MAX,
  AUDIT_LABELS,
  AUDIT_PAGE_DEFAULT,
  AUDIT_REASON_LABELS,
  type AuditEntryView,
  type AuditOwnPageView,
  type AuditPageView,
  type AuditQueryParams,
  labelKeyOf,
} from "@terrarium/core/contract";
import type { AuditEntry, AuditFilter, AuditStore } from "@terrarium/core/experiments";
import type { Viewer } from "./context";
import { allow } from "./permissions";

const isoOf = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : new Date(Date.parse(text)).toISOString();

/** The store's filter for a listing's query; `extra` pins what the caller decides, not the asker. */
function filterOf(
  q: Omit<AuditQueryParams, "subject"> & { readonly subject?: string | undefined },
  limit: number,
  extra: Partial<AuditFilter> = {},
): AuditFilter {
  const from = isoOf(q.from);
  const to = isoOf(q.to);
  return {
    limit,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(q.subject ? { subject: q.subject } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.resourceKind ? { resourceKind: q.resourceKind } : {}),
    ...(q.resourceId ? { resourceId: q.resourceId } : {}),
    ...(q.outcome ? { outcome: q.outcome } : {}),
    ...(q.cursor ? { before: Number(q.cursor) } : {}),
    ...extra,
  };
}

/** An entry as a screen needs it: its id (the order it was written), and the words for its action and reason. */
export function viewOf(entry: AuditEntry): AuditEntryView {
  const { seq, ...rest } = entry;
  return {
    ...rest,
    id: String(seq),
    labelKey: labelKeyOf(entry.action),
    label: AUDIT_LABELS[entry.action],
    ...(entry.reason ? { reasonLabel: AUDIT_REASON_LABELS[entry.reason] } : {}),
  };
}

export class AuditLog {
  constructor(private readonly store: AuditStore) {}

  /** Administrators only: the entries that match, newest first, a page at a time. */
  async list(viewer: Viewer, q: AuditQueryParams): Promise<AuditPageView> {
    allow(viewer, "administer", {}, "감사 기록 보기");
    const page = await this.store.query(filterOf(q, q.limit ?? AUDIT_PAGE_DEFAULT));
    return {
      entries: page.entries.map(viewOf),
      ...(page.next === undefined ? {} : { next: String(page.next) }),
    };
  }

  /** Administrators only: the newest matches as JSON Lines, one entry a line, up to `AUDIT_EXPORT_MAX`. */
  async export(viewer: Viewer, q: Omit<AuditQueryParams, "limit" | "cursor">): Promise<string> {
    allow(viewer, "administer", {}, "감사 기록 내려받기");
    const page = await this.store.query(filterOf(q, AUDIT_EXPORT_MAX));
    return page.entries.map((e) => `${JSON.stringify(viewOf(e))}\n`).join("");
  }

  /**
   * What happened to the things a person made: who, when, what and how it ended, for their things only. Nothing about
   * why a try was refused, where a request came from, or what else it did.
   */
  async mine(viewer: Viewer, q: Omit<AuditQueryParams, "subject">): Promise<AuditOwnPageView> {
    const page = await this.store.query(
      filterOf(q, q.limit ?? AUDIT_PAGE_DEFAULT, { owner: viewer.id }),
    );
    return {
      entries: page.entries.map((e) => ({
        id: String(e.seq),
        at: e.at,
        who: { id: e.subject.id, name: e.subject.name },
        action: e.action,
        labelKey: labelKeyOf(e.action),
        label: AUDIT_LABELS[e.action],
        outcome: e.outcome,
        resource: {
          kind: e.resource.kind,
          ...(e.resource.id ? { id: e.resource.id } : {}),
          ...(e.resource.name ? { name: e.resource.name } : {}),
        },
      })),
      ...(page.next === undefined ? {} : { next: String(page.next) }),
    };
  }
}
