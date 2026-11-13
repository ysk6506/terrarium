/**
 * The one recording point of the audit log (ADR-0193, permissions.md section 6). Every route of the contract is registered
 * through this: it opens a request's notes (what the decisions made while it ran say), reads the route's classification in
 * `AUDIT_CLASSES`, and when the request ends writes the entries. A handler writes nothing; a refusal is noted where it is decided
 * (`may`, `allow`, `mustSee`) and written here.
 *
 * What an entry holds comes from three places only: the person (`Viewer`), the route (its classification and the parts of the
 * address a lookup confirmed), and what the decisions noted. The body of a request and the content of an answer are looked
 * at for field names and for an id, a display name and a scope, and for nothing else.
 */
import {
  AUDIT_CLASSES,
  ForbiddenError,
  failsClosed,
  type Recorded,
  ROUTES,
  type RouteAudit,
  type RouteName,
  toErrorReply,
  UnauthenticatedError,
} from "@terrarium/core/contract";
import {
  type AuditReason,
  type AuditResource,
  type AuditSubject,
  type NewAuditEntry,
  SCOPES,
  type Scope,
} from "@terrarium/core/experiments";
import { NotFoundError } from "@terrarium/core/kernel";
import type { FastifyRequest } from "fastify";
import {
  type Auditor,
  AuditWriteError,
  isAdmin,
  keyOf,
  type Notes,
  newNotes,
  type Viewer,
  withNotes,
} from "../runtime";
import { SignInRefused } from "./identity";

/** What the end of a request knows about it. */
export interface Ended {
  readonly params: Readonly<Record<string, string>>;
  readonly query?: unknown;
  readonly body?: unknown;
  readonly response?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const NESTED = ["world", "scenario", "experiment"] as const;

/** The id a create answered with: `{ id }` or the record under its kind's name (`{ world }`, `{ experiment }`). */
export function idOfResponse(response: unknown): string | undefined {
  const r = asRecord(response);
  if (!r) return undefined;
  return (
    text(r.id) ?? text(r.experimentId) ?? NESTED.map((k) => text(asRecord(r[k])?.id)).find(Boolean)
  );
}

/** The name, owner and scope an answer says about the record it is about. */
export function standingOfResponse(response: unknown): Partial<AuditResource> {
  const r = asRecord(response);
  if (!r) return {};
  return standingOf(NESTED.map((k) => asRecord(r[k])).find(Boolean) ?? r);
}

/** The same, of a record itself (a row of a list), without looking for one inside it. */
function standingOf(inner: Record<string, unknown>): Partial<AuditResource> {
  const sharing = asRecord(inner.sharing);
  const scope = [sharing?.scope, inner.scope].find((s) =>
    (SCOPES as readonly unknown[]).includes(s),
  );
  const name = text(inner.name) ?? text(inner.title);
  const owner = text(inner.owner);
  const group = text(sharing?.group) ?? text(inner.group);
  return {
    ...(name ? { name } : {}),
    ...(owner ? { owner } : {}),
    ...(scope ? { scope: scope as Scope } : {}),
    ...(group ? { group } : {}),
  };
}

export function subjectOf(viewer: Viewer): AuditSubject {
  return {
    kind: "person",
    id: viewer.id,
    name: viewer.name,
    source: viewer.source,
    admin: isAdmin(viewer),
  };
}

/** The reason of a failure, from the status the person is told. */
function failure(err: unknown): AuditReason {
  switch (toErrorReply(err).status) {
    case 400:
      return "invalid_input";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 503:
      return "unavailable";
    default:
      return "error";
  }
}

/** The top-level names a request sent: what a change touched, never what it was set to. */
function namesOf(value: unknown): string[] | undefined {
  const r = asRecord(value);
  const names = r ? Object.keys(r).filter((k) => r[k] !== undefined) : [];
  return names.length > 0 ? names : undefined;
}

/** For a list: how many of the things it held are another person's, kept to themselves or to a group the asker is not in. */
function isKeptFromViewer(item: unknown, viewer: Viewer): boolean {
  const outer = asRecord(item);
  const r = asRecord(outer?.experiment) ?? outer;
  if (!r) return false;
  const standing = standingOf(r);
  const kept =
    standing.scope === "private" ||
    (standing.scope === "group" && !viewer.groups.includes(standing.group ?? ""));
  return standing.owner !== undefined && standing.owner !== viewer.id && kept;
}

function othersKept(response: unknown, viewer: Viewer): number {
  return Array.isArray(response)
    ? response.filter((item) => isKeptFromViewer(item, viewer)).length
    : 0;
}

const withStanding = (kind: string, rest: Partial<AuditResource>): AuditResource => ({
  kind,
  ...(rest.id ? { id: rest.id } : {}),
  ...(rest.name ? { name: rest.name } : {}),
  ...(rest.owner ? { owner: rest.owner } : {}),
  ...(rest.scope ? { scope: rest.scope } : {}),
  ...(rest.group ? { group: rest.group } : {}),
});

/** Header an administrator's screen sends with the reason for changing what is another person's (permissions.md section 6). */
export const REASON_HEADER = "x-terrarium-reason";
const REASON_MAX = 200;

/** The reason as it is kept: decoded, one Unicode form, no control characters, cut to length; nothing when nothing is left. */
export function reasonOf(raw: string | string[] | undefined): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(first);
  } catch {
    return undefined;
  }
  // control characters are what is taken out (they could break a log line)
  const clean = [...decoded.normalize("NFC")]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : ch;
    })
    .join("")
    .trim();
  return clean === "" ? undefined : clean.slice(0, REASON_MAX);
}

export class AuditedCall {
  readonly notes: Notes = newNotes();
  readonly class: RouteAudit;

  constructor(
    private readonly auditor: Auditor,
    private readonly name: RouteName,
    readonly requestId: string,
    private readonly remoteAddress: string | undefined,
    private readonly why: string | undefined = undefined,
  ) {
    this.class = AUDIT_CLASSES[name];
  }

  private get closed(): boolean {
    return failsClosed(this.name, ROUTES[this.name].method);
  }

  /** Run the request with its notes open; closed when it ends, so a stream or a worker continuing later notes nothing. */
  async within<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await withNotes(this.notes, fn);
    } finally {
      this.notes.closed = true;
    }
  }

  /** A route that changes things stops here, before the change, when the log could not take its entry. */
  async ready(): Promise<void> {
    if (this.closed) await this.auditor.ready();
  }

  private base(viewer: Viewer): Pick<NewAuditEntry, "requestId" | "subject" | "route"> {
    return { requestId: this.requestId, subject: subjectOf(viewer), route: this.name };
  }

  /** The id the route's classification says to take: from the address, from the answer, or from what a lookup found. */
  private idFor(kind: string, end: Ended): string | undefined {
    switch (this.class.id) {
      case "param":
        return end.params.id;
      case "response":
        return idOfResponse(end.response);
      case "note":
        return [...this.notes.found.values()].find((f) => f.kind === kind)?.id;
      default:
        return undefined;
    }
  }

  /** The thing the route is about. `trusted`: a lookup confirmed it, so the id in the address (or the answer) may be named. */
  private target(viewer: Viewer, end: Ended, trusted: boolean): AuditResource {
    const cls = this.class;
    const kind = cls.resource ?? "session";
    const id = trusted ? this.idFor(kind, end) : undefined;
    const noted = id === undefined ? undefined : this.notes.found.get(keyOf({ kind, id }));
    // what the lookup found is how the thing stood at that moment; an answer says how it stands after the change
    const held: Partial<AuditResource> = noted ?? (trusted ? standingOfResponse(end.response) : {});
    const made = cls.id === "response" && trusted ? viewer.id : undefined;
    return withStanding(kind, {
      ...held,
      ...(id ? { id } : {}),
      owner: held.owner ?? this.notes.owner ?? made,
    });
  }

  /** The request went through. A change always writes `allowed`; an administrator's sight of another's private thing writes a read. */
  async succeeded(viewer: Viewer, end: Ended): Promise<void> {
    const cls = this.class;
    if (cls.records === "none") return;
    if (cls.records === "read-override") return this.readOverrides(viewer, end, cls);
    const fields = namesOf(end.body) ?? namesOf(end.query);
    const entry: NewAuditEntry = {
      ...this.base(viewer),
      action: cls.action,
      outcome: "allowed",
      resource: this.target(viewer, end, true),
      ...(fields ? { fields } : {}),
      ...(this.notes.changes.length > 0 ? { changes: this.notes.changes } : {}),
      // only an administrator's own words: anyone else's header is not a reason the screen asked for
      ...(this.why && isAdmin(viewer) ? { detail: { reason: this.why } } : {}),
    };
    if (this.closed) await this.auditor.record(entry);
    else await this.auditor.tryRecord(entry);
  }

  private async readOverrides(viewer: Viewer, end: Ended, cls: Recorded): Promise<void> {
    if (!isAdmin(viewer)) return;
    const base = { ...this.base(viewer), action: cls.action, outcome: "allowed" } as const;
    if (cls.list) {
      const count = othersKept(end.response, viewer);
      if (count > 0)
        await this.auditor.tryRecord({
          ...base,
          resource: { kind: cls.resource },
          detail: { count },
        });
      return;
    }
    for (const seen of this.notes.overrides)
      await this.auditor.tryRecord({ ...base, resource: withStanding(seen.kind, seen) });
  }

  /**
   * The request ended in an error. A refusal is written on every route; a failure only where a change was tried.
   * `before` is true when the refusal came ahead of any lookup (the sign-in, the admin-only policy), so no id is named.
   */
  async refused(viewer: Viewer, err: unknown, end: Ended, before = false): Promise<void> {
    if (err instanceof AuditWriteError) return;
    const entry = this.entryForError(viewer, err, end, before);
    if (entry) await this.auditor.tryRecord(entry);
  }

  private entryForError(
    viewer: Viewer,
    err: unknown,
    end: Ended,
    before: boolean,
  ): NewAuditEntry | undefined {
    const cls = this.class;
    const base = this.base(viewer);
    if (err instanceof UnauthenticatedError)
      return {
        ...base,
        action: "auth.sign_in",
        outcome: "denied",
        reason: err instanceof SignInRefused ? err.why : "unauthenticated",
        resource: { kind: "session" },
        ...(this.remoteAddress ? { remoteAddress: this.remoteAddress } : {}),
      };
    const action = cls.action ?? "access.denied";
    const denial = this.notes.denial;
    const hidden = err instanceof NotFoundError && denial?.reason === "not_visible";
    if (err instanceof ForbiddenError || hidden) {
      const target = denial?.ref ?? this.target(viewer, end, !before);
      return {
        ...base,
        action,
        outcome: "denied",
        reason: denial?.reason ?? "not_allowed",
        resource: withStanding(target.kind, { ...denial?.standing, ...target }),
      };
    }
    if (cls.records !== "change") return undefined;
    const reason = failure(err);
    const fields = namesOf(end.body);
    return {
      ...base,
      action,
      outcome: "failed",
      reason,
      resource: this.target(viewer, end, reason === "conflict"),
      ...(fields ? { fields } : {}),
    };
  }
}

/** Start the audit of one request. The address is the socket's own, never a forwarded header. */
export function auditCall(auditor: Auditor, name: RouteName, req: FastifyRequest): AuditedCall {
  return new AuditedCall(
    auditor,
    name,
    req.id,
    req.socket?.remoteAddress,
    reasonOf(req.headers[REASON_HEADER]),
  );
}
