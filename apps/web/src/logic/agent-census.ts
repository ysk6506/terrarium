/**
 * What the connection screen says about the agents a harness has and the ones it left out (REQ-079,
 * ADR-0085). The server sends counts and reasons as data; the sentences are made here, in the glossary's
 * words: a plain word first, then the state exactly as the harness writes it, in quotes.
 */
import type { AgentCensus } from "@terrarium/core/contract";
import type { AgentInfo } from "@terrarium/core/experiments";

/** How a reason the server sent reads on the screen: an easy word, then the harness's own word in quotes. */
const REASONS: Readonly<Record<string, string>> = {
  "status inactive": "쉬는 중('inactive')",
  "status summoning": "만드는 중('summoning')",
  "status summon_failed": "만들다 멈춘('summon_failed')",
  "hidden helper": "OpenCode가 안에서 쓰는 도우미('hidden')",
  "mode subagent": "다른 에이전트가 부르는 서브에이전트('subagent')",
};

/** The state as a phrase that can stand before "라 숨겼어요" or "인 에이전트". */
export function reasonPhrase(reason: string): string {
  const known = REASONS[reason];
  if (known) return known;
  const status = /^status (.+)$/.exec(reason)?.[1];
  return status ? `상태가 '${status}'` : `'${reason}'`;
}

export interface CensusText {
  /** The first line: how many there are, how many show. */
  readonly headline: string;
  /** One line per reason, then the server's notes. */
  readonly lines: readonly string[];
  /** The button that shows the left-out ones, or puts them away again. Left out when nothing was left out. */
  readonly action?: "모두 보기" | "다시 숨기기";
}

/** "에이전트 37개 중 1개가 보여요" and why the other 36 are not. */
export function censusText(census: AgentCensus, showing = census.includesHidden): CensusText {
  const left = census.hidden.reduce((n, h) => n + h.count, 0);
  const notes = census.notes;
  if (census.total === 0)
    return {
      headline: census.empty ? `에이전트가 없어요 — ${census.empty}.` : "에이전트가 없어요.",
      lines: notes,
    };
  if (left === 0) return { headline: `에이전트 ${census.total}개가 있어요.`, lines: notes };
  const why = census.hidden.map((h) =>
    showing
      ? `${h.count}개는 ${reasonPhrase(h.reason)}라 평소에는 숨겨요.`
      : `${h.count}개는 ${reasonPhrase(h.reason)}라 숨겼어요.`,
  );
  const headline = showing
    ? `에이전트 ${census.total}개를 모두 보여 줘요.`
    : census.shown === 0
      ? `에이전트 ${census.total}개가 모두 숨겨져 있어요.`
      : `에이전트 ${census.total}개 중 ${census.shown}개가 보여요.`;
  return { headline, lines: [...why, ...notes], action: showing ? "다시 숨기기" : "모두 보기" };
}

/**
 * One line for an agent that was left out and is being used anyway: the experiment may get no answer.
 * Nothing for an agent the harness lists as it is.
 */
export function hiddenWarning(agent: Pick<AgentInfo, "hidden"> | undefined): string | undefined {
  return agent?.hidden
    ? `${reasonPhrase(agent.hidden)}인 에이전트는 실험에서 답하지 않을 수 있어요.`
    : undefined;
}
