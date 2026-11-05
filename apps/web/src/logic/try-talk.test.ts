import type { TryResult } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { DEFAULT_QUESTION, traceAdvice, tryDetail, tryFacts } from "./try-talk";

const result = (extra: Partial<TryResult> = {}): TryResult => ({
  ok: true,
  text: "안녕",
  ms: 1840,
  toolCalls: 0,
  trace: { name: "Langfuse", linked: true, spans: 3 },
  ...extra,
});

describe("말 걸어 보기 tells how it went in one line [REQ-079]", () => {
  test("the first sentence is a question every agent can answer", () => {
    expect(DEFAULT_QUESTION).toBe("지금 할 수 있는 일을 한 줄로 말해 줘");
  });

  test("time, tools and the trace link, with numbers and units", () => {
    expect(tryFacts(result()).map((f) => f.text)).toEqual([
      "1.8초 걸렸어요",
      "툴 호출 없음",
      "트레이스 이어짐 ✓",
    ]);
    expect(tryFacts(result({ toolCalls: 2 }))[1]?.text).toBe("툴 호출 2번");
  });

  test("a trace that did not link says which tag is missing, in warning colour", () => {
    const facts = tryFacts(
      result({
        trace: {
          name: "Langfuse",
          linked: false,
          spans: 0,
          note: "run_id 태그가 안 보여요. 하네스를 봐 주세요.",
        },
      }),
    );
    expect(facts[2]).toEqual({ text: "안 이어짐 — run_id 태그가 안 보여요", tone: "warn" });
    expect(traceAdvice({ name: "Langfuse", linked: false, spans: 0, note: "다음에 할 일" })).toBe(
      "다음에 할 일",
    );
  });

  test("no place chosen for traces, and a tool that could not be read, are told apart", () => {
    expect(tryFacts(result({ trace: { spans: 0 } }))[2]).toEqual({
      text: "트레이스를 쌓을 곳을 정하지 않았어요",
      tone: "neutral",
    });
    const unread = { name: "ClickStack", spans: 0, note: "ClickStack에서 읽지 못했어요: 404" };
    expect(tryFacts(result({ trace: unread }))[2]?.text).toBe("ClickStack에서 읽지 못했어요: 404");
    expect(traceAdvice(unread)).toBe(unread.note);
    expect(traceAdvice({ name: "x", linked: true, spans: 1 })).toBeUndefined();
  });

  test("a failed turn has no facts, and the detail line lists the model and the tokens when known", () => {
    expect(tryFacts(result({ ok: false, error: "401" }))).toEqual([]);
    expect(tryDetail(result({ model: "qwen3", tokens: { input: 12, output: 6 } }))).toBe(
      "모델 qwen3 · 토큰 18개",
    );
    expect(tryDetail(result())).toBe("");
  });
});
