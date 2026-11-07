/**
 * 입력칸에 쓴 글이 질문인지 부탁인지 가른다 (REQ-103, ADR-0124): "실험 만들기"처럼 짧고 동작 이름과 맞으면 그 동작,
 * "IAP 세계로 실험 하나 만들어 줘"처럼 부탁으로 끝나고 동작의 말을 담으면 그 동작, 나머지는 모두 질문이에요.
 */
import type { ActionArgs, ActionSpec } from "./types";

const SHORT = 12;
const ASKING =
  /(\?|？|왜|뭐|무엇|무슨|어떻게|어떤|언제|어디|얼마|몇|누가|누구|인가요|나요|까요|있어요|예요$|이에요$|건가요)/;
const REQUESTING =
  /(줘|주세요|해봐|할래|할게|하자|가자|열어|보여|만들어|시작해|골라|정해|멈춰|취소해|바꿔)(요|\.|!)*$/;

/** 비교하려고 공백과 문장부호를 없앤 글. */
export const squash = (s: string): string => s.toLowerCase().replace(/[\s.,!?~'"“”‘’·()-]+/g, "");

export type Intent = "question" | "command";

export interface Parsed {
  readonly intent: Intent;
  readonly action?: ActionSpec;
  readonly args: ActionArgs;
}

function hitLength(text: string, action: ActionSpec): number {
  const names = [action.label, ...(action.aliases ?? [])].map(squash);
  return Math.max(
    0,
    ...names.filter((n) => n.length >= 2 && text.includes(n)).map((n) => n.length),
  );
}

export function argsOf(raw: string): ActionArgs {
  const n = /(\d+)\s*(번|회)/.exec(raw)?.[1];
  return { text: raw, ...(n ? { n: Number(n) } : {}) };
}

/** 글 하나를 읽는다. 동작은 `actions`(지금 화면에서 쓸 수 있는 것) 안에서만 찾아요. */
export function parseInput(raw: string, actions: readonly ActionSpec[]): Parsed {
  const text = squash(raw);
  const asking = ASKING.test(raw);
  const requesting = REQUESTING.test(raw.trim());
  const shortEnough = text.length <= SHORT && !asking;
  if (text === "" || asking || !(shortEnough || requesting))
    return { intent: "question", args: {} };
  const best = actions
    .map((a) => ({ a, len: hitLength(text, a) }))
    .filter((x) => x.len > 0)
    .sort((x, y) => y.len - x.len)[0];
  return best
    ? { intent: "command", action: best.a, args: argsOf(raw) }
    : { intent: "question", args: {} };
}
