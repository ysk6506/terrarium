/** "말 걸어 보기" on the connection screen (REQ-079, ADR-0085): the first question, and the one line about how it went. */
import type { TryResult } from "@terrarium/core/contract";

/** What is sent when the person has not written anything: a question every agent can answer. */
export const DEFAULT_QUESTION = "지금 할 수 있는 일을 한 줄로 말해 줘";

export interface Fact {
  readonly text: string;
  readonly tone: "good" | "warn" | "neutral";
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}초`;

/** Where the traces went: found, not found and what to look at, or nothing to check. */
function traceFact(trace: TryResult["trace"]): Fact {
  if (trace.linked === true) return { text: "트레이스 이어짐 ✓", tone: "good" };
  if (trace.linked === false) return { text: "안 이어짐 — run_id 태그가 안 보여요", tone: "warn" };
  if (trace.name) return { text: trace.note ?? `${trace.name}를 확인하지 못했어요`, tone: "warn" };
  return { text: "트레이스를 쌓을 곳을 정하지 않았어요", tone: "neutral" };
}

/** How long it took, whether tools were called, whether the traces came along. */
export function tryFacts(result: TryResult): Fact[] {
  if (!result.ok) return [];
  return [
    { text: `${seconds(result.ms)} 걸렸어요`, tone: "neutral" },
    {
      text: result.toolCalls === 0 ? "툴 호출 없음" : `툴 호출 ${result.toolCalls}번`,
      tone: "neutral",
    },
    traceFact(result.trace),
  ];
}

/** The model and the tokens, when the harness told. */
export function tryDetail(result: TryResult): string {
  const parts = [
    result.model ? `모델 ${result.model}` : "",
    result.tokens ? `토큰 ${result.tokens.input + result.tokens.output}개` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The sentence under the facts when traces did not link: what to do next. */
export function traceAdvice(trace: TryResult["trace"]): string | undefined {
  return trace.linked === false || (trace.name && trace.linked === undefined)
    ? trace.note
    : undefined;
}
