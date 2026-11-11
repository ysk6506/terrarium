/**
 * Who may see a record (ADR-0174, permissions.md section 3): its scope, and the one rule that reads it. The server's
 * `may(viewer, "see", ...)` and every store's filtered lists use this rule, so a list never holds what a get would refuse.
 */

export const SCOPES = ["private", "group", "everyone"] as const;
export type Scope = (typeof SCOPES)[number];

/** The scope a record carries: `group` is the id of the owner's group it is shared with when the scope is `group`. */
export interface Shared {
  readonly scope?: Scope;
  readonly group?: string;
}

/** Whoever is looking, as far as seeing goes. */
export interface Sight {
  readonly id: string;
  readonly groups: readonly string[];
  readonly admin: boolean;
}

/** Nobody in particular: sees only what is for everyone. Counts that must not depend on who asks (leaderboards, titles) use it. */
export const PUBLIC_SIGHT: Sight = { id: "", groups: [], admin: false };

/** A record stored before scopes existed has none, and was visible to every signed-in person: it reads as `everyone`. */
export const scopeOf = (record: Shared): Scope => record.scope ?? "everyone";

/** Can this person see the record? Admin, owner, `everyone`, or `group` with a group the person belongs to. */
export function seen(sight: Sight, record: Shared & { readonly owner?: string }): boolean {
  if (sight.admin) return true;
  const scope = scopeOf(record);
  if (scope === "everyone") return true;
  if (record.owner !== undefined && sight.id !== "" && record.owner === sight.id) return true;
  return scope === "group" && record.group !== undefined && sight.groups.includes(record.group);
}

/** The scope fields as the records keep them: `group` only when the scope is `group`. */
export function sharedOf(scope: Scope, group?: string): Shared {
  return scope === "group" && group !== undefined ? { scope, group } : { scope };
}

/** A record as it is shown: the scope it has, spelled out even when it was stored without one. */
export function withScope<T extends Shared>(record: T): T & { readonly scope: Scope } {
  return { ...record, scope: scopeOf(record) };
}

/** Why a choice of scope cannot be made, in words, or nothing when it can. `mine` are the groups of the person choosing. */
export function scopeProblem(
  choice: { readonly scope: Scope; readonly group?: string | undefined },
  mine: readonly string[],
  kept?: string,
): string | undefined {
  if (choice.scope !== "group") return undefined;
  if (mine.length === 0 && kept === undefined)
    return "속한 그룹이 없어서 '우리 파트'로는 정할 수 없어요. 나만이나 모두로 정해 주세요";
  if (choice.group === undefined) return "어느 그룹과 나눌지 정해 주세요 (group)";
  if (choice.group !== kept && !mine.includes(choice.group))
    return "내가 속한 그룹만 고를 수 있어요";
  return undefined;
}
