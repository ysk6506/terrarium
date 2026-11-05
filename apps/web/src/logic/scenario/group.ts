/**
 * Big conditions in the scoring sheet (REQ-034). A template's end state is "every server has power", one small
 * condition per server, so a group can hold dozens of leaves. A group of up to three children stays open as a form;
 * a bigger one is folded into one line in words and a count, and opens when someone asks.
 */
import { CONDITION_FIELDS, type Condition, describeCondition } from "@terrarium/core/scenario";
import { type BlueprintIndex, KIND_LABELS } from "@terrarium/core/world";

/** A group with more children than this starts folded. */
export const OPEN_GROUP_LIMIT = 3;

export type Group = Extract<Condition, { kind: "all" | "any" }>;

export const isGroup = (c: Condition): c is Group => c.kind === "all" || c.kind === "any";

/** Whether a condition's form starts folded: a group with more than three children. */
export function startsCollapsed(c: Condition): boolean {
  return isGroup(c) && c.of.length > OPEN_GROUP_LIMIT;
}

/** The conditions a group is made of, looking through groups of its own kind ("all" of "all" is one "all"). */
export function leavesOf(c: Group): Condition[] {
  return c.of.flatMap((x) => (x.kind === c.kind ? leavesOf(x as Group) : [x]));
}

/** "서버 24대" for the same kind of equipment, counted the way it is counted. */
function countedKind(index: BlueprintIndex, entity: string, n: number): string | undefined {
  const kind = index.find(entity)?.kind;
  if (!kind) return undefined;
  return `${KIND_LABELS[kind]} ${n}${kind === "server" || kind === "vm" ? "대" : "개"}`;
}

/** What one state condition says about its device, without the device's name: "전원 공급", "흡기 온도 > 35 °C". */
function predicate(c: Extract<Condition, { kind: "state" }>, index: BlueprintIndex): string {
  const name = index.find(c.entity)?.name ?? c.entity;
  const text = describeCondition(c, index);
  const rest = text.startsWith(name) ? text.slice(name.length).trim() : text;
  const field = CONDITION_FIELDS[index.find(c.entity)?.kind ?? "server"]?.[c.field];
  if (c.value === true && c.op === "==" && field?.type === "boolean") return field.label;
  return rest;
}

function sameAsFirst(states: Extract<Condition, { kind: "state" }>[], index: BlueprintIndex) {
  const [a] = states;
  if (!a) return false;
  const kind = index.find(a.entity)?.kind;
  return states.every(
    (s) =>
      s.field === a.field &&
      s.op === a.op &&
      s.value === a.value &&
      index.find(s.entity)?.kind === kind,
  );
}

/** One line for a group, e.g. "서버 24대가 모두 전원 공급"; a mixed group names its first condition and counts the rest. */
export function groupSummary(c: Group, index: BlueprintIndex): string {
  const leaves = leavesOf(c);
  const every = c.kind === "all";
  const states = leaves.filter(
    (x): x is Extract<Condition, { kind: "state" }> => x.kind === "state",
  );
  const first = states[0];
  if (first && states.length === leaves.length && sameAsFirst(states, index)) {
    const who = countedKind(index, first.entity, leaves.length);
    if (who) return `${who}${every ? "가 모두" : " 중 하나라도"} ${predicate(first, index)}`;
  }
  const head = leaves[0] ? describeCondition(leaves[0], index) : "";
  return `${head} 외 ${Math.max(0, leaves.length - 1)}개가 ${every ? "모두 맞을 때" : "하나라도 맞을 때"}`;
}

/**
 * The sentence under a condition form. A big group has none: its folded line already says it, and a sentence
 * that joins dozens of conditions with "그리고" is the wall this file exists to avoid.
 */
export function conditionLine(c: Condition, index: BlueprintIndex): string {
  return isGroup(c) && leavesOf(c).length > OPEN_GROUP_LIMIT ? "" : describeCondition(c, index);
}

/** The value a state condition should hold when its field changes, so a yes/no field never keeps a number. */
export function valueForField(
  index: BlueprintIndex,
  entity: string,
  field: string,
  current: boolean | number | string,
): boolean | number | string {
  const spec = CONDITION_FIELDS[index.find(entity)?.kind ?? "server"]?.[field];
  if (spec?.type === "boolean") return typeof current === "boolean" ? current : true;
  if (spec?.type === "number") return typeof current === "number" ? current : 0;
  return typeof current === "string" ? current : "ok";
}
