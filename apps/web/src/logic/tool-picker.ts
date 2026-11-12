/**
 * Choosing the tools of an experiment (REQ-080, ADR-0087 items 1, 2 and 5): cards by area, each folding out to its
 * tools; a search over all of them; "the tools this scenario needs" worked out from its faults; the reality tag of
 * every tool; and which scenarios the chosen tools can still solve.
 */
import type { ScenarioRecord } from "@terrarium/core/experiments";
import { withJosa } from "@terrarium/core/kernel";
import {
  requiredTools,
  type ScenarioDoc,
  type ScopeCheck,
  scopeCheck,
} from "@terrarium/core/scenario";
import type { FaultScope, ToolPickCheck } from "@terrarium/core/session";
import {
  REALISM_LABELS,
  type Realism,
  TOOL_AREA_LABELS,
  TOOL_AREAS,
  TOOL_DOCS,
  TOOL_SPECS,
  type ToolArea,
  type ToolSpec,
} from "@terrarium/core/tools";

/** Tools that cannot be turned off: the agent always has to be able to answer. */
export const LOCKED_TOOLS: readonly string[] = ["submit_diagnosis"];

/** What is said when a tool a real team does not have is turned on (ADR-0087 item 2). */
export const UNREAL_NOTE = "현실엔 거의 없는 툴이에요 — 이 툴의 가치를 재는 실험이 돼요";

export interface ToolRow {
  readonly name: string;
  readonly title: string;
  readonly realism: Realism;
  /** 흔함 / 드묾 / 없음 */
  readonly realismLabel: string;
  readonly on: boolean;
  readonly locked: boolean;
  /** Shown under a tool that real teams hardly have, once it is on. */
  readonly note?: string;
}

export interface AreaCard {
  readonly area: ToolArea;
  readonly label: string;
  readonly tools: readonly ToolRow[];
  readonly onCount: number;
  readonly total: number;
}

const realismOf = (name: string): Realism => TOOL_DOCS[name]?.realism ?? "common";

/** Whether a tool answers a search: by its name, its title, its card or its reality tag. */
export function matchesSearch(spec: ToolSpec, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const area = spec.area ? TOOL_AREA_LABELS[spec.area] : "";
  return [spec.name, spec.title, area, REALISM_LABELS[realismOf(spec.name)]]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/** The cards, each with its tools that answer the search (a card with none is left out while searching). */
export function areaCards(
  selected: readonly string[],
  query = "",
  alreadyGiven: readonly string[] = [],
): AreaCard[] {
  const on = new Set([...selected, ...LOCKED_TOOLS, ...alreadyGiven]);
  const cards = TOOL_AREAS.map((area): AreaCard => {
    const all = TOOL_SPECS.filter((t) => t.area === area);
    const tools = all
      .filter((t) => matchesSearch(t, query))
      .map((t): ToolRow => {
        const realism = realismOf(t.name);
        const isOn = on.has(t.name);
        return {
          name: t.name,
          title: t.title,
          realism,
          realismLabel: REALISM_LABELS[realism],
          on: isOn,
          locked: LOCKED_TOOLS.includes(t.name) || alreadyGiven.includes(t.name),
          ...(isOn && realism !== "common" && !alreadyGiven.includes(t.name)
            ? { note: UNREAL_NOTE }
            : {}),
        };
      });
    return {
      area,
      label: TOOL_AREA_LABELS[area],
      tools,
      onCount: all.filter((t) => on.has(t.name)).length,
      total: all.length,
    };
  });
  return query.trim() === "" ? cards : cards.filter((c) => c.tools.length > 0);
}

/** Turn tools on or off; the locked ones stay on. */
export function setTools(
  selected: readonly string[],
  names: readonly string[],
  on: boolean,
): string[] {
  const change = new Set(names.filter((n) => !LOCKED_TOOLS.includes(n)));
  const rest = selected.filter((t) => !change.has(t));
  return on ? [...rest, ...change] : rest;
}

export interface Need {
  /** What the scenario needs, fewest first (ADR-0087 item 5). */
  readonly tools: readonly string[];
  /** The ones not turned on yet. */
  readonly missing: readonly string[];
  /** What is on is exactly what it needs: "필요한 것만 켜기" would change nothing. */
  readonly exact: boolean;
}

/** "이 시나리오에 필요한 툴 n개": from the faults of the scenario, and which of them are still off. */
export function needOf(
  doc: ScenarioDoc | undefined,
  selected: readonly string[],
): Need | undefined {
  if (!doc) return undefined;
  const tools = requiredTools(doc);
  const have = new Set([...selected, ...LOCKED_TOOLS]);
  const wanted = new Set(tools);
  return {
    tools,
    missing: tools.filter((t) => !have.has(t)),
    exact: have.size === wanted.size && [...have].every((t) => wanted.has(t)),
  };
}

/** "필요한 것만 켜기": exactly the tools the scenario needs. */
export function onlyNeeded(doc: ScenarioDoc): string[] {
  return requiredTools(doc).filter((t) => !LOCKED_TOOLS.includes(t));
}

/** The name people read for a tool. */
export const titleOf = (name: string): string =>
  TOOL_SPECS.find((t) => t.name === name)?.title ?? name;

export interface ScenarioChoice {
  readonly id: string;
  readonly name: string;
  readonly items: number;
  readonly check: ScopeCheck;
  /** Greyed out: faults are limited to the given tools and these cannot solve it. */
  readonly out: boolean;
  /** Why it cannot be solved, shown whether or not it is greyed out. */
  readonly reason?: string;
}

/** Each scenario of a world, and whether the chosen tools can solve it (ADR-0087 item 5). */
export function scenarioChoices(
  records: readonly ScenarioRecord[],
  tools: readonly string[],
  scope: FaultScope,
): ScenarioChoice[] {
  return records.map((r) => {
    const check = scopeCheck(r.doc, [...tools, ...LOCKED_TOOLS]);
    return {
      id: r.id,
      name: r.name,
      items: r.doc.expectations.length,
      check,
      out: scope === "inside" && !check.inScope,
      ...(check.reason ? { reason: check.reason } : {}),
    };
  });
}

/** The line under a scenario that is out of reach when faults are not limited: a way to measure asking for help. */
export const OUT_BUT_ALLOWED = "준 툴로는 풀 수 없어요. 넘기기를 재는 실험이 돼요";

// ── the tool-pick check (ADR-0087 item 3) ──────────────────────────────────────────────────

/** `hit`: picked and a person would accept it · `extra`: picked, not what a person expects · `miss`: expected, not picked. */
export type PickCell = "hit" | "extra" | "miss" | "";

export interface PickMatrix {
  /** The tools that were picked in some situation or expected in one, in catalog order. */
  readonly columns: readonly string[];
  readonly rows: readonly {
    readonly id: string;
    readonly label: string;
    readonly cells: readonly PickCell[];
  }[];
  /** Pairs the descriptions cannot tell apart, with the situations where both were picked. */
  readonly pairs: readonly {
    readonly a: string;
    readonly b: string;
    readonly situations: readonly string[];
  }[];
}

export const PICK_WORDS = {
  TITLE: "툴 고르기 점검",
  LEDE: "툴 설명만 읽는 기준 에이전트가 상황마다 어느 툴을 고르는지 봐요. 같은 상황에 둘 다 고르면 설명으로는 못 가려요",
  HIT: "맞게 골랐어요",
  EXTRA: "골랐지만 기대한 툴은 아니에요",
  MISS: "기대한 툴인데 못 골랐어요",
  NO_PAIR: "설명으로 못 가리는 쌍이 없어요",
  PAIR_HEAD: "설명으로 못 가리는 쌍",
  pair: (a: string, b: string) => `${withJosa(titleOf(a), "과")} ${withJosa(titleOf(b), "이")}`,
  FIX: "한쪽 설명에 '대신 무엇을 쓰나'를 적어 주세요",
} as const;

/** The matrix of situations by tools, and the ambiguous pairs, as the panel draws them. */
export function pickMatrix(check: ToolPickCheck): PickMatrix {
  const used = new Set(check.rows.flatMap((r) => [...r.picked, ...r.situation.best]));
  const columns = check.tools.filter((t) => used.has(t));
  const label = (id: string) =>
    check.rows.find((r) => r.situation.id === id)?.situation.label ?? id;
  return {
    columns,
    rows: check.rows.map((r) => ({
      id: r.situation.id,
      label: r.situation.label,
      cells: columns.map((t): PickCell => {
        const picked = r.picked.includes(t);
        const best = r.situation.best.includes(t);
        if (picked) return best ? "hit" : "extra";
        return best ? "miss" : "";
      }),
    })),
    pairs: check.ambiguous.map((p) => ({ a: p.a, b: p.b, situations: p.situations.map(label) })),
  };
}
