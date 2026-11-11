/**
 * Choosing who can see a record (ADR-0174, permissions.md section 3): the scope a new record starts with, and the one
 * function every change of scope goes through, so that step 다 can write the audit line in one place.
 */
import { InvalidInputError } from "@terrarium/core/contract";
import { type Scope, type Shared, scopeProblem } from "@terrarium/core/experiments";
import type { Viewer } from "./context";
import { allow, may } from "./permissions";

/** What a request may say about it: both fields are optional. */
export interface ScopeChoice {
  readonly scope?: Scope | undefined;
  readonly group?: string | undefined;
}

/**
 * The scope fields a record is stored with. `everyone` is stored as no scope at all, which reads as `everyone`: a record
 * made for everyone is the same bytes as one made before scopes existed.
 */
export function fieldsOf(scope: Scope, group?: string): Shared {
  if (scope === "everyone") return {};
  return scope === "group" && group !== undefined ? { scope, group } : { scope };
}

function refuse(message: string): never {
  throw new InvalidInputError(message, [{ path: "scope", message }]);
}

/** A choice that can be made by this person, or an error that says why not. `kept` is the group a record already has. */
function checked(viewer: Viewer, scope: Scope, group: string | undefined, kept?: string): Shared {
  const named = group ?? kept;
  const problem = scopeProblem({ scope, group: named }, viewer.groups, kept);
  if (problem) refuse(problem);
  return fieldsOf(scope, named);
}

/** The scope fields for a new record: what the request chose, else the resource's usual start. */
export function startingScope(viewer: Viewer, req: ScopeChoice, usual: Scope): Shared {
  return checked(viewer, req.scope ?? usual, req.group);
}

/**
 * Change who can see a record: its maker or an admin (`changeScope`). The one function every change of scope goes through.
 * Returns the record with its new scope fields; storing it is the caller's.
 */
export function changeScope<T extends Shared & { readonly owner: string }>(
  viewer: Viewer,
  record: T,
  choice: ScopeChoice,
  what: string,
): T {
  allow(viewer, "changeScope", { owner: record.owner }, what);
  const { scope: _s, group: _g, ...rest } = record;
  if (choice.scope === undefined) return record;
  return { ...rest, ...checked(viewer, choice.scope, choice.group, record.group) } as T;
}

/** Whether the person asking may change who sees it (for the views). */
export const canChangeScope = (viewer: Viewer, owner: string | undefined): boolean =>
  may(viewer, "changeScope", { owner }).ok;
