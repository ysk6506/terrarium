/**
 * The palette as three questions (REQ-071, beta feedback 18): 어디가 고장 나나요 / 에이전트가 뭘 하면 되나요 / 어떻게
 * 채점하나요. A question opens to its own blocks only, with the few that are used most often first and the rest behind
 * "더 보기"; a search looks across all three. The third question's blocks are scoring lines, which live on the sheet.
 */
import type { ExpectationKind, PaletteItem, ScenarioDoc } from "@terrarium/core/scenario";
import { EXPECTATION_LABELS } from "./sheet";

export type QuestionId = "fault" | "task" | "score";

export interface Question {
  readonly id: QuestionId;
  readonly title: string;
  readonly hint: string;
}

export const QUESTIONS: readonly Question[] = [
  {
    id: "fault",
    title: "어디가 고장 나나요",
    hint: "고장을 놓으면 채점표의 정답 줄이 저절로 채워져요",
  },
  {
    id: "task",
    title: "에이전트가 뭘 하면 되나요",
    hint: "에이전트를 언제 부르고 무엇을 맡길지 정해요",
  },
  {
    id: "score",
    title: "어떻게 채점하나요",
    hint: "점수는 채점표 문장에서 고쳐요",
  },
];

/** A block in the palette: a block of the flow, or a scoring line that goes on the sheet. */
export type Entry =
  | { readonly kind: "block"; readonly key: string; readonly item: PaletteItem }
  | {
      readonly kind: "score";
      readonly key: string;
      readonly score: ExpectationKind;
      readonly label: string;
      readonly description: string;
    };

const SCORE_ORDER: readonly ExpectationKind[] = [
  "diagnosis",
  "required_action",
  "forbidden_action",
  "final_state",
  "time_limit",
  "tool_budget",
];

const SCORE_HINTS: Readonly<Record<ExpectationKind, string>> = {
  diagnosis: "원인을 맞히면 점수를 줘요. 고장 블록에서 저절로 채워져요",
  required_action: "에이전트가 이 조치를 하면 점수를 줘요",
  forbidden_action: "이 조치를 하면 한 번마다 점수를 깎아요",
  final_state: "끝났을 때 세계가 이 상태면 점수를 줘요",
  time_limit: "정해진 시간 안에 진단하면 점수를 줘요",
  tool_budget: "툴을 적게 부르면 점수를 줘요",
};

export const SCORE_LABELS: Readonly<Record<ExpectationKind, string>> = {
  diagnosis: "진단 맞히기",
  required_action: "조치 기대하기",
  forbidden_action: "하면 안 되는 일",
  final_state: "끝났을 때 상태",
  time_limit: "빨리 진단하기",
  tool_budget: "툴 호출 상한",
};

/** Which question a block of the flow answers: faults and changes to the world, or the agent and the waiting around it. */
export function questionOf(item: PaletteItem): QuestionId {
  return item.category === "fault" || item.category === "operation" ? "fault" : "task";
}

/** The blocks used most often, in the order they are shown. The rest are one press of "더 보기" away. */
const COMMON: Readonly<Record<"fault" | "task", readonly string[]>> = {
  fault: [
    "inject_fault:cooling_unit_failure",
    "inject_fault:breaker_trip",
    "inject_fault:disk_failure",
    "inject_fault:link_down",
    "clear_fault",
    "set_load",
  ],
  task: ["agent_task", "wait", "wait_until", "branch", "note"],
};

/** Every entry of a question, the common ones first and flagged. */
export function entriesOf(
  question: QuestionId,
  items: readonly PaletteItem[],
): { readonly common: Entry[]; readonly more: Entry[] } {
  if (question === "score") {
    const all = SCORE_ORDER.map(
      (score): Entry => ({
        kind: "score",
        key: `score:${score}`,
        score,
        label: SCORE_LABELS[score],
        description: SCORE_HINTS[score],
      }),
    );
    return { common: all, more: [] };
  }
  const mine = items
    .filter((i) => questionOf(i) === question)
    .map((item): Entry => ({ kind: "block", key: item.key, item }));
  const wanted = COMMON[question];
  const common = wanted
    .map((key) => mine.find((m) => m.key === key))
    .filter((m): m is Entry => m !== undefined && m.kind === "block" && m.item.available);
  const more = mine.filter((m) => !common.includes(m));
  return { common, more };
}

/** The entries whose name or description holds the words searched for, across all three questions. */
export function searchEntries(items: readonly PaletteItem[], query: string): Entry[] {
  const q = query.trim();
  if (!q) return [];
  const out: Entry[] = [];
  for (const question of QUESTIONS) {
    const { common, more } = entriesOf(question.id, items);
    for (const entry of [...common, ...more]) {
      const text =
        entry.kind === "block"
          ? `${entry.item.label} ${entry.item.description} ${entry.item.group ?? ""}`
          : `${entry.label} ${entry.description} ${EXPECTATION_LABELS[entry.score]}`;
      if (text.includes(q)) out.push(entry);
    }
  }
  return out;
}

/** Which question to open first: the first one the scenario has no answer to yet. */
export function firstOpen(doc: ScenarioDoc): QuestionId {
  if (!doc.nodes.some((n) => n.type === "inject_fault")) return "fault";
  if (!doc.nodes.some((n) => n.type === "agent_task")) return "task";
  return "score";
}
