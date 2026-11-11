/**
 * The one place that decides "may this person do this to this" (ADR-0174). Every route that changes
 * something names its action in the contract; the handler (or the app, for actions that need no
 * resource) asks `may`, and nothing else in the server compares owners or scopes. The function is pure, so the
 * whole table of who may do what is the table of its tests.
 *
 * Seeing is one of the things it decides (`see`, permissions.md section 3): a person sees a record that is for
 * everyone, or is theirs, or is shared with a group they belong to; an admin sees all. Using a connection needs sight.
 */
import { type Decided, ForbiddenError } from "@terrarium/core/contract";
import { type Scope, type Shared, type Sight, scopeOf, seen } from "@terrarium/core/experiments";
import { NotFoundError, withJosa } from "@terrarium/core/kernel";
import type { HarnessDirectory, Viewer } from "./context";

/** What the action is about, as far as the decision needs it. */
export interface Resource {
  /** Login id of whoever made it. Left out: nobody did (a config-file connection), so only admins manage it. */
  readonly owner?: string | undefined;
  /** Login id of whoever made a share link; the link's own maker may take it back. */
  readonly creator?: string | undefined;
  /**
   * Who can see it, as the record reads (`scopeOf`). A resource with an owner and no scope reads as private, the safe
   * side; one with neither (the config file's connection) is for every signed-in person.
   */
  readonly scope?: Scope | undefined;
  /** The group a `group` scope is shared with. */
  readonly group?: string | undefined;
}

export type Decision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: Decision = { ok: true };
const no = (reason: string): Decision => ({ ok: false, reason });

export const isAdmin = (viewer: Viewer): boolean => viewer.roles.includes("admin");
export const isSignedIn = (viewer: Viewer): boolean => viewer.roles.includes("user");

/** What the read rule needs of a person; the stores filter their lists with it. */
export const sightOf = (viewer: Viewer): Sight => ({
  id: viewer.id,
  groups: viewer.groups,
  admin: isAdmin(viewer),
});

/** A record's own scope fields as a resource, with the scope it reads as. */
export const standing = (record: Shared & { readonly owner?: string }): Resource => ({
  owner: record.owner,
  scope: scopeOf(record),
  group: record.group,
});

/** Said when a thing is refused for not being the maker's. */
function makerOnly(owner: string | undefined): Decision {
  return no(
    owner === undefined
      ? "관리자만 할 수 있어요 (서버 설정 파일에 적힌 것이에요)"
      : `만든 사람(${owner})이나 관리자만 할 수 있어요`,
  );
}

/** The maker, or an admin. A thing nobody made (the config file's) is for admins. */
function makerOrAdmin(viewer: Viewer, resource: Resource): Decision {
  return resource.owner === viewer.id || isAdmin(viewer) ? OK : makerOnly(resource.owner);
}

/** The read rule for a resource that says its scope. */
function sees(viewer: Viewer, resource: Resource): boolean {
  if (resource.owner === undefined && resource.scope === undefined) return true;
  return seen(sightOf(viewer), { ...resource, scope: resource.scope ?? "private" });
}

const NOT_SEEN = "볼 수 없는 것이에요";

function decide(viewer: Viewer, action: Decided, resource: Resource): Decision {
  switch (action) {
    case "administer":
      return isAdmin(viewer) ? OK : no("관리자만 할 수 있어요");
    case "like":
      return viewer.source === "anonymous" ? no("좋아요는 이름을 정한 뒤에 누를 수 있어요") : OK;
    case "see":
    case "use":
      // Using a connection or a model needs sight: the config file's are for every signed-in person, the rest for whoever
      // can see them (their maker, admins, the group or everyone they were shared with).
      return sees(viewer, resource) ? OK : no(NOT_SEEN);
    case "deleteShare":
      return resource.creator === viewer.id ? OK : makerOrAdmin(viewer, resource);
    default:
      return makerOrAdmin(viewer, resource);
  }
}

/** Is the cancel button theirs to press? */
export function mayCancel(viewer: Viewer, owner: string): boolean {
  return may(viewer, "cancel", { owner }).ok;
}

/** May this viewer do this to this? Said in one place, answered without side effects. */
export function may(viewer: Viewer, action: Decided, resource: Resource = {}): Decision {
  if (!isSignedIn(viewer)) return no("로그인이 필요해요");
  return decide(viewer, action, resource);
}

/** Can this viewer see this? The question every get and every list asks. */
export const canSee = (viewer: Viewer, resource: Resource): boolean =>
  may(viewer, "see", resource).ok;

/**
 * Something the viewer cannot see answers as if it were not there (no hint that it exists): the same words a missing
 * one gets. `what` is the thing in the person's words, as "세계 w1".
 */
export function mustSee(viewer: Viewer, resource: Resource, what: string): void {
  if (!canSee(viewer, resource)) throw new NotFoundError(`${withJosa(what, "을")} 찾을 수 없어요`);
}

/** The connection as a resource: who made it and who sees it; the config file's carries neither. */
export const connectionResource = (
  harnesses: Pick<HarnessDirectory, "standingOf" | "ownerOf">,
  id: string,
): Resource => harnesses.standingOf?.(id) ?? { owner: harnesses.ownerOf?.(id) };

/**
 * An experiment runs on a connection with its maker's secrets, so it is made by whoever may use that connection: whoever
 * can see it. A connection that is not there is left to the checks that name it.
 */
export function allowRunOn(
  viewer: Viewer,
  harnesses: Pick<HarnessDirectory, "standingOf" | "ownerOf">,
  harnessId: string,
): void {
  mustSee(viewer, connectionResource(harnesses, harnessId), `하네스 '${harnessId}'`);
}

/** `may`, as an error for the handler to throw: `what` is the thing being refused, in the person's words. */
export function allow(
  viewer: Viewer,
  action: Decided,
  resource: Resource = {},
  what?: string,
): void {
  const verdict = may(viewer, action, resource);
  if (!verdict.ok)
    throw new ForbiddenError(
      what ? `${withJosa(what, "은")} ${verdict.reason}` : `이 일은 ${verdict.reason}`,
    );
}
