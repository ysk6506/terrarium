import type { LlmModelView, ModelCheckView } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  blankModelForm,
  cardFacts,
  checkedWhen,
  checkLine,
  createModelBody,
  deleteText,
  formOfModel,
  LIMIT_LINE,
  MODEL_KIND_CARDS,
  modelFirstStep,
  modelKindName,
  modelProblems,
  modelSectionState,
  msText,
  updateModelBody,
} from ".";

const view = (extra: Partial<LlmModelView> = {}): LlmModelView => ({
  id: "llm-1",
  name: "사내 GPT",
  kind: "openai",
  baseUrl: "https://llm.corp.test",
  hasKey: true,
  keyHint: "…ab12",
  headers: ["X-Gateway-Token"],
  isDefault: false,
  owner: "yeonsu",
  createdAt: "2026-11-06T01:00:00.000Z",
  ...extra,
});

const check = (extra: Partial<ModelCheckView> = {}): ModelCheckView => ({
  at: "2026-11-06T01:00:00.000Z",
  ok: true,
  ms: 412,
  via: "models",
  models: [],
  modelCount: 23,
  ...extra,
});

describe("the model section's state and words [REQ-099]", () => {
  test("loading, empty and list are the three states of the section", () => {
    expect(modelSectionState(undefined)).toBe("loading");
    expect(modelSectionState([])).toBe("empty");
    expect(modelSectionState([view()])).toBe("list");
  });

  test("the three kinds have cards in order, with the labels the card shows", () => {
    expect(MODEL_KIND_CARDS.map((c) => c.kind)).toEqual(["litellm", "openai", "anthropic"]);
    expect(modelKindName("litellm")).toBe("LiteLLM");
    expect(modelKindName("anthropic")).toBe("Claude 호환");
    expect(LIMIT_LINE).toBe(
      "쓰는 곳: 이끼 — 기본 모델이 이끼의 답을 만들어요. 작은 모델이면 이끼의 답이 거칠 수 있어요.",
    );
  });

  test("the last check reads '답했어요 · 412ms · 모델 23개', or the honest reason", () => {
    expect(checkLine(check())).toEqual({ tone: "good", text: "답했어요 · 412ms · 모델 23개" });
    expect(checkLine(check({ via: "completion", modelCount: undefined, ms: 1830 }))).toEqual({
      tone: "good",
      text: "답했어요 · 1.8초 · 짧은 호출로 확인했어요",
    });
    expect(checkLine(check({ ok: false, error: "키를 받아 주지 않았어요 (401)." }))).toEqual({
      tone: "bad",
      text: "키를 받아 주지 않았어요 (401).",
    });
    expect(checkLine(undefined)).toEqual({ tone: "neutral", text: "아직 확인하지 않았어요" });
    expect(msText(999)).toBe("999ms");
  });

  test("when it was checked is relative, and nothing before the first check", () => {
    const now = Date.parse("2026-11-06T01:03:00.000Z");
    expect(checkedWhen(check(), now)).toBe("3분 전 확인");
    expect(checkedWhen(undefined, now)).toBeUndefined();
  });

  test("a card's facts: address, the default model's name, the end of the key", () => {
    expect(cardFacts(view({ defaultModel: "gpt-x" }))).toEqual([
      "https://llm.corp.test",
      "기본 모델 gpt-x",
      "키 …ab12",
    ]);
    expect(cardFacts(view({ hasKey: false }))).toEqual([
      "https://llm.corp.test",
      "기본 모델 이름 없음",
      "키 없음",
    ]);
  });

  test("deleting says what happens; the default one says where the default goes", () => {
    expect(deleteText(view(), 2)).toBe("등록을 지워요. 저장한 키도 지워져요.");
    expect(deleteText(view({ isDefault: true }), 1)).toContain(
      "가장 먼저 등록한 모델이 기본이 돼요",
    );
    expect(deleteText(view({ isDefault: true }), 0)).toBe("등록을 지워요. 저장한 키도 지워져요.");
  });
});

describe("the model form turns typing into requests [REQ-099]", () => {
  test("a new registration starts on the kind step; a known kind or a change starts on the fields", () => {
    expect(modelFirstStep(undefined, "")).toBe("kind");
    expect(modelFirstStep(undefined, "openai")).toBe("form");
    expect(modelFirstStep(view(), "")).toBe("form");
  });

  test("what is missing or wrong is named by field", () => {
    expect(Object.keys(modelProblems(blankModelForm()))).toEqual(["kind", "name", "baseUrl"]);
    const form = {
      ...blankModelForm("openai"),
      name: "a",
      baseUrl: "llm.corp.test",
      headers: [
        { name: "X-A", value: "", kept: false },
        { name: "x-a", value: "v", kept: false },
        { name: "bad name", value: "v", kept: false },
        { name: "", value: "v", kept: false },
      ],
    };
    const problems = modelProblems(form);
    expect(problems.baseUrl).toContain("https://");
    expect(problems["headers.0"]).toBe("값을 적어 주세요");
    expect(problems["headers.1"]).toBe("같은 이름의 헤더가 있어요");
    expect(problems["headers.2"]).toContain("쓸 수 없는");
    expect(problems["headers.3"]).toBe("헤더 이름을 적어 주세요");
    expect(modelProblems({ ...form, baseUrl: "https://ok.test", headers: [] })).toEqual({});
  });

  test("create leaves out the empty optional boxes and trims", () => {
    const body = createModelBody({
      ...blankModelForm("anthropic"),
      name: " Claude ",
      baseUrl: " https://api.anthropic.com ",
      apiKey: " sk-ant-1 ",
    });
    expect(body).toEqual({
      kind: "anthropic",
      name: "Claude",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-1",
      headers: [],
    });
  });

  test("changing: an empty key box keeps the key, a kept header sends no value, a new key or clear is explicit", () => {
    const start = formOfModel(view({ defaultModel: "gpt-x" }));
    expect(start).toMatchObject({ apiKey: "", name: "사내 GPT", defaultModel: "gpt-x" });
    expect(start.headers).toEqual([{ name: "X-Gateway-Token", value: "", kept: true }]);
    expect(updateModelBody(start)).toEqual({
      name: "사내 GPT",
      baseUrl: "https://llm.corp.test",
      defaultModel: "gpt-x",
      headers: [{ name: "X-Gateway-Token" }],
    });
    const typed = updateModelBody({
      ...start,
      apiKey: "sk-new",
      headers: [{ name: "X-Gateway-Token", value: "v2", kept: true }],
    });
    expect(typed).toMatchObject({
      apiKey: "sk-new",
      headers: [{ name: "X-Gateway-Token", value: "v2" }],
    });
    expect(updateModelBody({ ...start, clearKey: true })).toMatchObject({ clearKey: true });
    expect(modelProblems(start)).toEqual({});
  });
});
