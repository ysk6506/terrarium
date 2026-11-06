/**
 * Writing a runbook in the scenario editor's tab (REQ-082, ADR-0087 item 6): steps with what to do, what to check
 * and which tools to use; made by hand, from the best run's calls, or from the team's own text pasted in.
 */
import {
  MAX_RUNBOOK_STEPS,
  parseRunbookMarkdown,
  type Runbook,
  type RunbookStep,
  runbookProblems,
} from "@terrarium/core/tools";

export const RUNBOOK_WORDS = {
  TAB: "절차서",
  LEDE: "이 시나리오를 다루는 팀의 방법을 단계로 적어요. 실험에서 에이전트에게 주거나, 찾게 하거나, 안 줄 수 있어요.",
  NONE: "아직 절차서가 없어요",
  TITLE: "절차서 이름",
  TODO: "할 일",
  CHECK: "확인할 것",
  TOOLS: "쓰는 툴",
  ADD_STEP: "단계 더하기",
  ADD_TOOL: "툴 더하기",
  DRAFT: "최고 궤적에서 초안 만들기",
  DRAFT_NONE:
    "아직 끝난 실행이 없어요. 실험을 한 번 돌리면 가장 높은 점수의 툴 호출 순서로 초안을 만들어요",
  PASTE: "팀 SOP 붙여 넣기",
  PASTE_HELP: "마크다운 목록(1. 2. 3. 이나 - )을 단계로 나눠요. 목록이 없으면 한 단계로 넣어요",
  PASTE_GO: "단계로 나누기",
  PASTE_ONE: "목록을 찾지 못해서 한 단계로 넣었어요. 단계를 나눠 주세요",
  CLEAR: "절차서 지우기",
  UP: "위로",
  DOWN: "아래로",
  REMOVE: "단계 지우기",
  NO_TOOL: "툴이 없는 단계는 점수를 세지 않아요",
  full: (n: number) => `절차서는 ${n}단계까지 쓸 수 있어요`,
  drafted: (name: string, score: number) =>
    `'${name}'의 가장 높은 점수(${score}점) 실행에서 만들었어요`,
} as const;

export const EMPTY_RUNBOOK: Runbook = { title: "새 절차서", steps: [] };

const nextId = (steps: readonly RunbookStep[]): string => {
  const used = new Set(steps.map((s) => s.id));
  for (let n = steps.length + 1; ; n++) if (!used.has(`s${n}`)) return `s${n}`;
};

/** Number the steps again from 1, so ids follow the order. */
const renumber = (steps: readonly RunbookStep[]): RunbookStep[] =>
  steps.map((s, i) => ({ ...s, id: `s${i + 1}` }));

export function addStep(rb: Runbook): Runbook {
  if (rb.steps.length >= MAX_RUNBOOK_STEPS) return rb;
  return {
    ...rb,
    steps: [...rb.steps, { id: nextId(rb.steps), todo: "", check: "", tools: [] }],
  };
}

export function changeStep(
  rb: Runbook,
  id: string,
  change: Partial<Omit<RunbookStep, "id">>,
): Runbook {
  return { ...rb, steps: rb.steps.map((s) => (s.id === id ? { ...s, ...change } : s)) };
}

export function removeStep(rb: Runbook, id: string): Runbook {
  return { ...rb, steps: renumber(rb.steps.filter((s) => s.id !== id)) };
}

/** Move a step one place up (-1) or down (1). */
export function moveStep(rb: Runbook, id: string, by: -1 | 1): Runbook {
  const at = rb.steps.findIndex((s) => s.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= rb.steps.length) return rb;
  const steps = [...rb.steps];
  const [moved] = steps.splice(at, 1);
  steps.splice(to, 0, moved as RunbookStep);
  return { ...rb, steps: renumber(steps) };
}

export function addTool(rb: Runbook, id: string, tool: string): Runbook {
  const step = rb.steps.find((s) => s.id === id);
  if (!step || step.tools.includes(tool)) return rb;
  return changeStep(rb, id, { tools: [...step.tools, tool] });
}

export function removeTool(rb: Runbook, id: string, tool: string): Runbook {
  const step = rb.steps.find((s) => s.id === id);
  return step ? changeStep(rb, id, { tools: step.tools.filter((t) => t !== tool) }) : rb;
}

/** The team's text as a runbook, and whether it had a list to read. */
export const pasted = (text: string) => parseRunbookMarkdown(text);

/** What is wrong with a runbook, in words; empty when it is fine. */
export const problemsOf = (rb: Runbook): string[] => runbookProblems(rb);

/** Steps that name no tool: they are only thoughts, and the score does not count them. */
export const thoughtSteps = (rb: Runbook): number =>
  rb.steps.filter((s) => s.tools.length === 0).length;
