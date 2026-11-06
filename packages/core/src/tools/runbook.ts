/**
 * Runbooks (절차서): the team's way of handling a situation, as steps (ADR-0087 item 6). A step says what to do,
 * what to check and which tools to use. An experiment can give the runbook to the agent in its task, leave it to the
 * agent to find (the `search_runbooks` tool), or not give it at all; scoring compares what the agent did with it
 * (scenario/sop.ts), apart from the recovery-first score.
 */
import { TOOL_NAMES, toolSpec } from "./catalog";

export interface RunbookStep {
  readonly id: string;
  /** What to do, in a sentence. */
  readonly todo: string;
  /** What to look at to know it worked. May be empty. */
  readonly check: string;
  /** The tools that do it; any one of them counts. Empty when the step is only a thought, so scoring skips it. */
  readonly tools: readonly string[];
}

export interface Runbook {
  readonly title: string;
  readonly steps: readonly RunbookStep[];
}

export const MAX_RUNBOOK_STEPS = 30;

const stepId = (n: number) => `s${n}`;

const BULLET = /^\s*(?:\d{1,2}[.)]|[-*•])\s+(.*\S)\s*$/;
const HEADING = /^\s*#{1,3}\s+(.*\S)\s*$/;
const CHECK = /^\s*(?:확인|check)\s*[:：]\s*(.*\S)\s*$/i;
const TOOLS = /^\s*(?:툴|쓰는 툴|tools?)\s*[:：]\s*(.*\S)\s*$/i;

/** The tool names written in a piece of text (with or without backticks), in the order they come. */
export function toolsIn(text: string): string[] {
  const found = (text.match(/[a-z][a-z0-9_]+/g) ?? []).filter((w) => TOOL_NAMES.includes(w));
  return [...new Set(found)];
}

export interface ParsedRunbook {
  readonly runbook: Runbook;
  /** False when the text had no list to read, so the whole text became one step. */
  readonly parsed: boolean;
}

interface Draft {
  todo: string;
  check: string;
  tools: string[];
}

/** Add a line that belongs to the step above it: its check, its tools, or more of the sentence. */
function extend(step: Draft, line: string): void {
  const check = CHECK.exec(line);
  const tools = TOOLS.exec(line);
  if (check) step.check = check[1] as string;
  else if (tools) step.tools = toolsIn(tools[1] as string);
  else step.todo = `${step.todo} ${line.trim()}`.trim();
}

/** The title and the steps as written, before they are numbered. */
function readLines(markdown: string): { readonly title: string; readonly drafts: Draft[] } {
  let title = "";
  const drafts: Draft[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    const bullet = BULLET.exec(raw);
    const text = (bullet?.[1] ?? raw).trim();
    const last = drafts[drafts.length - 1];
    const heading = HEADING.exec(raw)?.[1];
    if (heading && !title && !last) title = heading;
    else if (last && (!bullet || CHECK.test(text) || TOOLS.test(text))) extend(last, text);
    else if (bullet) drafts.push({ todo: text, check: "", tools: [] });
  }
  return { title, drafts };
}

/** A step as written, numbered, with the tools it names in its own words when it lists none. */
const stepOf = (d: Draft, n: number): RunbookStep => ({
  id: stepId(n),
  todo: d.todo,
  check: d.check,
  tools: d.tools.length > 0 ? d.tools : toolsIn(d.todo),
});

/**
 * A team's runbook pasted as Markdown: a heading becomes the title, each numbered or bulleted line a step. A line
 * below a step that starts with "확인:" gives its check and "툴:" its tools; other indented lines continue the step.
 * A step that names tools in backticks without a "툴:" line gets them. Text with no list at all becomes one step
 * (`parsed` is false), so pasting never fails.
 */
export function parseRunbookMarkdown(markdown: string, fallbackTitle = "팀 절차서"): ParsedRunbook {
  const { title, drafts } = readLines(markdown);
  const name = title || fallbackTitle;
  if (drafts.length > 0)
    return {
      runbook: {
        title: name,
        steps: drafts.slice(0, MAX_RUNBOOK_STEPS).map((d, i) => stepOf(d, i + 1)),
      },
      parsed: true,
    };
  const whole = markdown.trim();
  const one: Draft = { todo: whole.slice(0, 2000), check: "", tools: toolsIn(whole) };
  return { runbook: { title: name, steps: whole ? [stepOf(one, 1)] : [] }, parsed: false };
}

/** The runbook as the agent reads it in its task. */
export function runbookPrompt(runbook: Runbook): string {
  const lines = runbook.steps.map((s, i) => {
    const check = s.check ? ` (확인: ${s.check})` : "";
    const tools = s.tools.length > 0 ? ` [툴: ${s.tools.join(", ")}]` : "";
    return `${i + 1}. ${s.todo}${check}${tools}`;
  });
  return `\n\n팀 절차서 "${runbook.title}"를 따라 일하라:\n${lines.join("\n")}`;
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];

/** The runbooks that fit a query, best first; with no query (or no match) all of them, so the agent can read titles. */
export function searchRunbooks(runbooks: readonly Runbook[], query: string): Runbook[] {
  const wanted = words(query);
  if (wanted.length === 0) return [...runbooks];
  const scored = runbooks
    .map((r) => {
      const text = words(
        `${r.title} ${r.steps.map((s) => `${s.todo} ${s.check} ${s.tools.join(" ")}`).join(" ")}`,
      );
      return { r, hits: wanted.filter((w) => text.some((t) => t.includes(w))).length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.length > 0 ? scored.map((x) => x.r) : [...runbooks];
}

/** Problems with a runbook in words; empty when it can be used. */
export function runbookProblems(runbook: Runbook): string[] {
  const out: string[] = [];
  if (runbook.steps.length === 0) out.push("절차서에 단계가 하나도 없어요");
  if (runbook.steps.length > MAX_RUNBOOK_STEPS)
    out.push(`절차서는 ${MAX_RUNBOOK_STEPS}단계까지 쓸 수 있어요`);
  for (const [i, step] of runbook.steps.entries()) {
    if (step.todo.trim() === "") out.push(`${i + 1}단계에 할 일이 없어요`);
    for (const t of step.tools) if (!toolSpec(t)) out.push(`${i + 1}단계의 '${t}'는 없는 툴이에요`);
  }
  return out;
}
