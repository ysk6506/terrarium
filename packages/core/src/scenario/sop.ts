/**
 * Runbook compliance and drafting (ADR-0087 item 6). Compliance is its own block of the result, read beside the
 * recovery-first score and never mixed into it: an agent that skips the runbook and recovers the service has
 * recovered the service, and the result says it also did not follow the procedure.
 *
 *   did it      a step is done when the agent made at least one successful call of a tool the step names
 *   in order    the done steps were first done in the runbook's order (a step done before an earlier one is out of order)
 *   skipped     the steps that name tools and were never done
 *
 * A step that names no tool is only a thought; it is not scored.
 */
import { type Runbook, type RunbookStep, TOOL_SPECS } from "@terrarium/core/tools";

/** The part of a tool call that compliance reads. */
export interface SopCall {
  readonly tool: string;
  readonly ok: boolean;
  readonly args?: Readonly<Record<string, unknown>>;
}

export interface SopStepResult {
  readonly id: string;
  readonly todo: string;
  readonly tools: readonly string[];
  /** False for a step that names no tool: it is left out of the counts. */
  readonly scored: boolean;
  readonly done: boolean;
  /** Which call (0-based, among all calls) first did it. */
  readonly firstCall?: number;
  /** Done at a point after the done steps before it. */
  readonly inOrder: boolean;
}

export interface SopCompliance {
  readonly title: string;
  readonly steps: readonly SopStepResult[];
  /** Steps that name tools. */
  readonly scored: number;
  readonly done: number;
  readonly inOrder: number;
  /** The steps never done. */
  readonly skipped: readonly string[];
  /** Tools the agent used that change the world and that no step names. */
  readonly extra: readonly string[];
  /** Done steps among scored ones, in percent. */
  readonly donePct: number;
  /** In-order steps among done ones, in percent (100 when fewer than two were done). */
  readonly orderPct: number;
  /** One number for "how closely did it follow": done steps, in order, among all scored steps. */
  readonly compliancePct: number;
}

const pct = (part: number, whole: number, empty = 100) =>
  whole === 0 ? empty : Math.round((part / whole) * 100);

const firstCallOf = (step: RunbookStep, calls: readonly SopCall[]): number | undefined => {
  const at = calls.findIndex((c) => c.ok && step.tools.includes(c.tool));
  return at < 0 ? undefined : at;
};

/** How closely the calls followed the runbook. */
export function scoreSop(runbook: Runbook, calls: readonly SopCall[]): SopCompliance {
  let latest = -1;
  const steps = runbook.steps.map((step): SopStepResult => {
    const scored = step.tools.length > 0;
    const first = scored ? firstCallOf(step, calls) : undefined;
    const inOrder = first !== undefined && first >= latest;
    if (first !== undefined) latest = Math.max(latest, first);
    return {
      id: step.id,
      todo: step.todo,
      tools: step.tools,
      scored,
      done: first !== undefined,
      ...(first === undefined ? {} : { firstCall: first }),
      inOrder,
    };
  });
  const scoredSteps = steps.filter((s) => s.scored);
  const done = scoredSteps.filter((s) => s.done).length;
  const inOrder = scoredSteps.filter((s) => s.done && s.inOrder).length;
  const named = new Set(runbook.steps.flatMap((s) => s.tools));
  const mutating = new Set(TOOL_SPECS.filter((t) => t.mutating).map((t) => t.name));
  const extra = [
    ...new Set(
      calls.filter((c) => c.ok && mutating.has(c.tool) && !named.has(c.tool)).map((c) => c.tool),
    ),
  ];
  const orderPct = pct(inOrder, done);
  return {
    title: runbook.title,
    steps,
    scored: scoredSteps.length,
    done,
    inOrder,
    skipped: scoredSteps.filter((s) => !s.done).map((s) => s.id),
    extra,
    donePct: pct(done, scoredSteps.length),
    orderPct,
    compliancePct: pct(inOrder, scoredSteps.length),
  };
}

const MAX_DRAFT_STEPS = 12;
/** Calls that say nothing about how the work was done. */
const SKIPPED_IN_DRAFT: ReadonlySet<string> = new Set(["wait", "submit_diagnosis", "ask_human"]);

function stepOf(
  tool: string,
  args: Readonly<Record<string, unknown>> | undefined,
  n: number,
): RunbookStep {
  const spec = TOOL_SPECS.find((t) => t.name === tool);
  const title = spec?.title ?? tool;
  const target = ["id", "unitId", "server", "host", "service", "device", "vm"]
    .map((k) => args?.[k])
    .find((v): v is string => typeof v === "string");
  const acts = spec?.mutating === true;
  return {
    id: `s${n}`,
    todo: `${acts ? "조치" : "살펴보기"}: ${title}${target ? ` (${target})` : ""}`,
    check: acts ? "조치 뒤 알람과 서비스 상태가 나아졌는지 확인" : "",
    tools: [tool],
  };
}

/**
 * A first draft of a runbook from the best run's calls: the successful ones in the order the agent made them, a
 * step per tool in a row. It is a start to edit, not a finished procedure.
 */
export function draftFromCalls(
  calls: readonly SopCall[],
  title = "최고 궤적에서 만든 초안",
): Runbook {
  const steps: RunbookStep[] = [];
  let previous = "";
  for (const call of calls) {
    if (!call.ok || SKIPPED_IN_DRAFT.has(call.tool) || call.tool === previous) continue;
    previous = call.tool;
    steps.push(stepOf(call.tool, call.args, steps.length + 1));
    if (steps.length >= MAX_DRAFT_STEPS) break;
  }
  return { title, steps };
}
