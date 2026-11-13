/**
 * Who can see a thing, in the words of the screens (ADR-0198, permissions.md sections 3 and 7): the one question "누가 볼 수
 * 있나요" with its three answers, when a list shows the answer and when it stays quiet, how a list is narrowed by it, and the
 * names people go by. Plain data: the screens only draw it.
 */
import type { LlmModelView, MetaView } from "@terrarium/core/contract";
import { SCOPES, type Scope } from "@terrarium/core/experiments";

export const SCOPE_QUESTION = "누가 볼 수 있나요";

/** What the question's three answers are called. */
export const SCOPE_LABELS: Readonly<Record<Scope, string>> = {
  private: "나만",
  group: "우리 파트",
  everyone: "모두",
};

/** What each answer means, said once under it. */
const SCOPE_HELP: Readonly<Record<Scope, string>> = {
  private: "만든 사람과 관리자만 볼 수 있어요.",
  group: "같은 그룹에 든 사람과 관리자가 볼 수 있어요.",
  everyone: "로그인한 모든 사람이 볼 수 있어요.",
};

/** The five kinds that carry the question. A connection and a model start private because credentials hang on them. */
export type ScopedKind = "world" | "scenario" | "experiment" | "connection" | "model";

export const START_SCOPE: Readonly<Record<ScopedKind, Scope>> = {
  world: "everyone",
  scenario: "everyone",
  experiment: "everyone",
  connection: "private",
  model: "private",
};

/** What is chosen: the scope, and the group when it is the group's. */
export interface ScopeValue {
  readonly scope: Scope;
  readonly group?: string;
}

export interface ScopeOption {
  readonly value: Scope;
  readonly label: string;
  readonly help: string;
}

/**
 * The answers a person can give. 우리 파트 needs a group: with none (the SSO gave none, or the person is on their own)
 * it is not offered, unless the thing already is shared that way (an administrator looking at it), so the choice never shows
 * what the server would refuse.
 */
export function scopeOptions(groups: readonly string[], current?: ScopeValue): ScopeOption[] {
  const hasGroup = groups.length > 0 || current?.scope === "group";
  return SCOPES.filter((s) => s !== "group" || hasGroup).map((value) => ({
    value,
    label: SCOPE_LABELS[value],
    help:
      value === "group" && groups.length === 1
        ? `그룹 '${groups[0]}'에 든 사람과 관리자가 볼 수 있어요.`
        : SCOPE_HELP[value],
  }));
}

/** The choice as the server takes it: a group scope names the group (the current one, else the person's first). */
export function scopeBody(value: ScopeValue, groups: readonly string[]): ScopeValue {
  if (value.scope !== "group") return { scope: value.scope };
  const group =
    value.group && groups.includes(value.group) ? value.group : (groups[0] ?? value.group);
  return group ? { scope: "group", group } : { scope: "group" };
}

/** Whether two choices are the same: nothing to save when they are. */
export const sameScope = (a: ScopeValue, b: ScopeValue): boolean =>
  a.scope === b.scope && (a.scope !== "group" || a.group === b.group);

/** The tag a list puts on a thing: nothing for "모두" (the usual), the answer for the others. */
export function scopeTag(item: {
  readonly scope?: Scope;
  readonly group?: string;
}): string | undefined {
  const scope = item.scope ?? "everyone";
  if (scope === "everyone") return undefined;
  return scope === "group" && item.group
    ? `${SCOPE_LABELS.group} · ${item.group}`
    : SCOPE_LABELS[scope];
}

/** A line for the list's title attribute and for screen readers: who sees it, in a sentence. */
export function scopeSentence(item: { readonly scope?: Scope; readonly group?: string }): string {
  const scope = item.scope ?? "everyone";
  return scope === "group" && item.group
    ? `그룹 '${item.group}'에 든 사람과 관리자가 볼 수 있어요`
    : SCOPE_HELP[scope].replace(/\.$/, "");
}

/** Narrowing a list by who can see it. 내 것 is about who made it; the other two are about the answer. */
export type ScopeFilter = "all" | "mine" | "group" | "everyone";

export const SCOPE_FILTER_LABEL = "누가 볼 수 있나요로 거르기";

export function scopeFilters(hasGroups: boolean): { value: ScopeFilter; label: string }[] {
  return [
    { value: "all", label: "전부" },
    { value: "mine", label: "내 것" },
    ...(hasGroups ? [{ value: "group" as const, label: SCOPE_LABELS.group }] : []),
    { value: "everyone", label: SCOPE_LABELS.everyone },
  ];
}

export function matchesFilter(
  filter: ScopeFilter,
  item: { readonly owner?: string; readonly scope?: Scope },
  me: string | undefined,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "mine":
      return me !== undefined && item.owner === me;
    case "group":
      return item.scope === "group";
    case "everyone":
      return (item.scope ?? "everyone") === "everyone";
  }
}

/** A list narrowed to a filter that matches nothing says why, and what to do. */
export function emptyFilterText(filter: ScopeFilter): string {
  switch (filter) {
    case "mine":
      return "내가 만든 것이 아직 없어요.";
    case "group":
      return "우리 파트에 나눈 것이 아직 없어요. 만든 사람이 '우리 파트'로 정하면 여기에 나와요.";
    case "everyone":
      return "모두에게 열어 둔 것이 아직 없어요.";
    default:
      return "";
  }
}

/** The groups the person is in, from the meta; none when it has not arrived or the SSO gave none. */
export const groupsOf = (meta: MetaView | undefined): readonly string[] => meta?.user.groups ?? [];

export const isAdmin = (meta: MetaView | undefined): boolean =>
  meta?.user.roles.includes("admin") === true;

/** Names by login id, for lists: the people the server has heard, and the person looking. */
export function peopleNames(meta: MetaView | undefined): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const p of meta?.people ?? []) names.set(p.id, p.name);
  if (meta) names.set(meta.user.id, meta.user.name);
  return names;
}

/** Whoever made a thing, as a list says it: the name they go by, else the id the record holds. */
export const ownerName = (owner: string, names: ReadonlyMap<string, string>): string =>
  names.get(owner) ?? owner;

/**
 * Two things with the same name, told apart by who made them: for a list of models (the same name may be two people's).
 * The ids that appear more than once among the names, case and spacing left alone.
 */
export function repeatedNames(items: readonly { readonly name: string }[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { name } of items) {
    if (seen.has(name)) twice.add(name);
    seen.add(name);
  }
  return twice;
}

/** Why there may be no default model, and the way to one (permissions.md section 3). */
export const NO_DEFAULT_WHY =
  "모두의 기본 모델은 '모두'가 볼 수 있는 모델만 될 수 있어요. 모델을 '나만'이나 '우리 파트'로 두었다면 기본이 될 수 없고, 그때는 각자 볼 수 있는 모델 중 먼저 등록한 것을 써요.";

/** Whether a model can be made the default by the person looking, and when it cannot, what to change first. */
export function defaultNote(view: LlmModelView): {
  readonly canSet: boolean;
  readonly why?: string;
} {
  if (!view.sharing.canChange) return { canSet: false };
  if (view.sharing.scope !== "everyone")
    return {
      canSet: false,
      why: "'나만'이나 '우리 파트'인 모델은 기본이 될 수 없어요. '누가 볼 수 있나요'를 '모두'로 바꾸면 기본으로 정할 수 있어요.",
    };
  return { canSet: true };
}

/** What a screen says to a person who may not open something (403, or 404 which also covers "not visible"). */
export interface BlockedWords {
  readonly title: string;
  readonly body: string;
}

export function blockedWords(status: number): BlockedWords | undefined {
  if (status === 404)
    return {
      title: "볼 수 없어요",
      body: "없어졌거나, 만든 사람이 누가 볼 수 있나요를 '나만'이나 '우리 파트'로 뒀어요. 만든 사람에게 '모두'로 바꿔 달라고 하거나, 같은 그룹인지 확인해 보세요.",
    };
  if (status === 403)
    return {
      title: "이 일은 할 수 없어요",
      body: "만든 사람이나 관리자만 할 수 있어요. 보기만 하거나, 복제해서 내 것으로 만들어 쓸 수 있어요.",
    };
  return undefined;
}

/** How the person at the foot of the rail is told apart, and what that means (permissions.md section 1). */
export interface WhoLine {
  readonly name: string;
  readonly note: string;
  readonly unsafe: boolean;
}

export function whoLine(
  meta: MetaView | undefined,
  typed: string | undefined,
): WhoLine | undefined {
  if (meta?.identity.mode === "proxy")
    return { name: meta.user.name, note: "회사 로그인으로 확인된 이름", unsafe: false };
  const name = typed ?? meta?.user.name;
  if (!name) return undefined;
  return { name, note: "직접 적은 이름 · 권한이 없는 방식", unsafe: true };
}
