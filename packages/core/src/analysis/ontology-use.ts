/**
 * What the experiment's agent really used of the actions a world needs (REQ-112, ADR-0135): for each action, who did
 * it — the agent on its own, the agent after asking a person, a person on site, another team — and how often. The
 * count is read off the runs' tool calls and hand-offs; nothing here is estimated.
 */
import { CONTROL_ROWS, type ToolCallRecord } from "@terrarium/core/scenario";
import type { Blueprint, RunEvent } from "@terrarium/core/world";
import {
  actionLabel,
  actionsFor,
  type OntologyAction,
  type OntologyNeeds,
  PHYSICAL_ACTION,
} from "./ontology";

export type Doer = "agent" | "approved" | "physical" | "handoff";

/** Which doer a tie goes to: what the agent did itself first. */
export const DOERS: readonly Doer[] = ["agent", "approved", "handoff", "physical"];

export const DOER_LABELS: Readonly<Record<Doer | "none", string>> = {
  agent: "에이전트",
  approved: "승인 뒤",
  physical: "물리",
  handoff: "넘기기",
  none: "안 씀",
};

export interface UsedAction {
  readonly id: string;
  readonly label: string;
  readonly counts: Readonly<Record<Doer, number>>;
  readonly total: number;
  /** Who did it most; `none` when it was never used. */
  readonly doer: Doer | "none";
  /** Every use came after the agent asked a person. */
  readonly alwaysApproved: boolean;
  /** False for an action the agent used that no scenario of the world needs (it came after those that are needed). */
  readonly needed: boolean;
}

export interface OntologyUse {
  readonly runs: number;
  readonly actions: readonly UsedAction[];
  /** How many actions each doer did most, and how many nobody used. */
  readonly byDoer: Readonly<Record<Doer | "none", number>>;
  readonly alwaysApproved: number;
  readonly line: string;
}

export interface UseRun {
  readonly toolCalls: readonly ToolCallRecord[];
  readonly events: readonly RunEvent[];
}

type Tally = Map<string, Record<Doer, number>>;

const blank = (): Record<Doer, number> => ({ agent: 0, approved: 0, physical: 0, handoff: 0 });

function bump(tally: Tally, id: string, doer: Doer): void {
  const row = tally.get(id) ?? blank();
  row[doer]++;
  tally.set(id, row);
}

/** The control row an action of this kind on this target is: the one that names the target's kind, else the first. */
function actionIdOf(kind: string, target: string, blueprint: Blueprint): string | undefined {
  const rows = CONTROL_ROWS.filter((r) => r.actions.some((a) => a === kind));
  const entity = blueprint.entities.find((e) => e.id === target);
  const isLink = !entity && blueprint.links.some((l) => l.id === target);
  const want = entity?.kind ?? (isLink ? "link" : undefined);
  return (rows.find((r) => want && r.targets.some((t) => t === want)) ?? rows[0])?.id;
}

/** Calls in order: an action that follows `ask_human` (before any other action) is "승인 뒤". */
function tallyCalls(tally: Tally, calls: readonly ToolCallRecord[], blueprint: Blueprint): void {
  let asked = false;
  for (const c of calls) {
    if (c.tool === "ask_human") asked = true;
    const effects = c.effects ?? [];
    for (const a of effects) {
      const id = actionIdOf(a.action, a.target, blueprint);
      if (id) bump(tally, id, asked ? "approved" : "agent");
    }
    if (effects.length > 0) asked = false;
  }
}

/** Faults handed to another team: the work is theirs, on site or not; the action is the one that clears the fault. */
function tallyHandoffs(tally: Tally, events: readonly RunEvent[]): void {
  for (const e of events) {
    if (e.kind !== "counterpart" || e.what !== "handed") continue;
    for (const f of e.faults) {
      const ids = actionsFor(f.faultType);
      bump(
        tally,
        f.onSite || ids.length === 0 ? PHYSICAL_ACTION : (ids[0] as string),
        f.onSite ? "physical" : "handoff",
      );
    }
  }
}

const doerOf = (counts: Record<Doer, number>): Doer | "none" => {
  let best: Doer | "none" = "none";
  let most = 0;
  for (const d of DOERS)
    if (counts[d] > most) {
      most = counts[d];
      best = d;
    }
  return best;
};

function usedAction(
  action: Pick<OntologyAction, "id" | "label">,
  counts: Record<Doer, number>,
  needed: boolean,
): UsedAction {
  const total = DOERS.reduce((s, d) => s + counts[d], 0);
  return {
    needed,
    id: action.id,
    label: action.label,
    counts,
    total,
    doer: doerOf(counts),
    alwaysApproved: total > 0 && counts.approved === total,
  };
}

function lineOf(use: Omit<OntologyUse, "line">): string {
  if (use.actions.every((a) => a.total === 0))
    return "이 실험은 세계를 바꾸는 액션을 쓰지 않았어요.";
  if (use.alwaysApproved > 0)
    return `항상 승인으로 간 액션 ${use.alwaysApproved}개는 키네틱 층에서 승인 액션으로 설계할 것이에요.`;
  if (use.byDoer.physical + use.byDoer.handoff > 0)
    return `사람이나 다른 팀 손에 남은 액션 ${use.byDoer.physical + use.byDoer.handoff}개는 키네틱 층에 자동으로 옮기기 어려워요.`;
  return "승인 없이 에이전트가 한 액션뿐이에요. 키네틱 층에서 자동 액션으로 둬도 돼요.";
}

/** Who did each action the world needs, over the runs of one experiment. */
export function deriveUse(
  needs: OntologyNeeds,
  runs: readonly UseRun[],
  blueprint: Blueprint,
): OntologyUse {
  const tally: Tally = new Map();
  for (const r of runs) {
    tallyCalls(tally, r.toolCalls, blueprint);
    tallyHandoffs(tally, r.events);
  }
  const wanted = new Set(needs.actions.map((a) => a.id));
  const extra = [...tally]
    .filter(([id]) => !wanted.has(id))
    .map(([id, counts]) => usedAction({ id, label: actionLabel(id) }, counts, false))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const actions = [
    ...needs.actions.map((a) => usedAction(a, tally.get(a.id) ?? blank(), true)),
    ...extra,
  ];
  const byDoer: Record<Doer | "none", number> = {
    agent: 0,
    approved: 0,
    physical: 0,
    handoff: 0,
    none: 0,
  };
  for (const a of actions) byDoer[a.doer]++;
  const base = {
    runs: runs.length,
    actions,
    byDoer,
    alwaysApproved: actions.filter((a) => a.alwaysApproved).length,
  };
  return { ...base, line: lineOf(base) };
}
