/**
 * The one place that decides "may this person do this to this" (ADR-0174). Every route that changes
 * something names its action in the contract; the handler (or the app, for actions that need no
 * resource) asks `may`, and nothing else in the server compares owners. The function is pure, so the
 * whole table of who may do what is the table of its tests.
 */
import { type Action, ForbiddenError } from "@terrarium/core/contract";
import { withJosa } from "@terrarium/core/kernel";
import type { HarnessDirectory, Viewer } from "./context";

/** What the action is about, as far as the decision needs it. */
export interface Resource {
  /** Login id of whoever made it. Left out: nobody did (a config-file connection), so only admins manage it. */
  readonly owner?: string | undefined;
  /** Login id of whoever made a share link; the link's own maker may take it back. */
  readonly creator?: string | undefined;
}

export type Decision = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: Decision = { ok: true };
const no = (reason: string): Decision => ({ ok: false, reason });

export const isAdmin = (viewer: Viewer): boolean => viewer.roles.includes("admin");
export const isSignedIn = (viewer: Viewer): boolean => viewer.roles.includes("user");

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

function decide(viewer: Viewer, action: Action, resource: Resource): Decision {
  switch (action) {
    case "administer":
      return isAdmin(viewer) ? OK : no("관리자만 할 수 있어요");
    case "like":
      return viewer.source === "anonymous" ? no("좋아요는 이름을 정한 뒤에 누를 수 있어요") : OK;
    case "use":
      // A connection of the config file is for every signed-in person; one made on the screen carries its maker's secrets.
      return resource.owner === undefined ? OK : makerOrAdmin(viewer, resource);
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
export function may(viewer: Viewer, action: Action, resource: Resource = {}): Decision {
  if (!isSignedIn(viewer)) return no("로그인이 필요해요");
  return decide(viewer, action, resource);
}

/** An experiment runs on a connection with its maker's secrets, so it is made by whoever may use that connection. */
export function allowRunOn(
  viewer: Viewer,
  harnesses: Pick<HarnessDirectory, "ownerOf">,
  harnessId: string,
): void {
  allow(viewer, "use", { owner: harnesses.ownerOf?.(harnessId) }, "이 연결로 실험 만들기");
}

/** `may`, as an error for the handler to throw: `what` is the thing being refused, in the person's words. */
export function allow(
  viewer: Viewer,
  action: Action,
  resource: Resource = {},
  what?: string,
): void {
  const verdict = may(viewer, action, resource);
  if (!verdict.ok)
    throw new ForbiddenError(
      what ? `${withJosa(what, "은")} ${verdict.reason}` : `이 일은 ${verdict.reason}`,
    );
}
