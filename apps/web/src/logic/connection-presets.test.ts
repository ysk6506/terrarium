import type { ConnectionView, ConnectorSpec } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  advancedFields,
  presetOf,
  presetProblems,
  presetSettings,
  splitAddress,
  typedUrl,
} from "./connection-presets";
import { blankForm, configOf, formOf, formProblems } from "./connections";

/** The HTTP API connector as the server describes it, reduced to what the presets touch. */
const spec: ConnectorSpec = {
  kind: "http-template",
  label: "HTTP",
  description: "",
  scope: "agent",
  toolTransport: "mcp",
  fromScreen: true,
  toolGuide: [],
  fields: [
    { key: "url", label: "API 주소", type: "url", required: true },
    { key: "token", label: "토큰", type: "secret" },
    { key: "model", label: "모델 이름", type: "text" },
    { key: "startPath", label: "시작 요청 주소", type: "text", default: "/" },
    {
      key: "startBody",
      label: "시작 요청 본문",
      type: "textarea",
      default: '{"prompt": "{{prompt}}"}',
    },
    { key: "pollSeconds", label: "간격", type: "number", default: 2 },
  ],
  presets: [
    {
      key: "openai",
      label: "OpenAI 호환 채팅",
      description: "",
      fields: [
        { key: "url", label: "주소", type: "url", required: true },
        { key: "model", label: "모델 이름", type: "text", required: true },
        { key: "token", label: "토큰", type: "secret" },
      ],
      fixed: {
        startBody:
          '{"model": "[[model]]", "messages": [{"role": "user", "content": "{{prompt}}"}]}',
        replyPointer: "/choices/0/message/content",
        preset: "openai",
      },
      urlPath: { into: "startPath", append: "/chat/completions" },
      promise: { request: "", reply: "" },
    },
    {
      key: "simple",
      label: "간단 JSON",
      description: "",
      fields: [{ key: "url", label: "주소", type: "url", required: true }],
      fixed: {
        startBody: '{"prompt": "{{prompt}}", "tools": "{{mcpUrl}}"}',
        replyPointer: "/text",
        preset: "simple",
      },
      urlPath: { into: "startPath" },
      promise: { request: "", reply: "" },
    },
  ],
};

const typed = (preset: string, values: Record<string, string>) => ({
  ...blankForm(spec),
  preset,
  values: { ...blankForm(spec).values, ...values },
});

describe("a preset stands for a whole template [REQ-079]", () => {
  test("a new form starts on the first preset", () => {
    expect(blankForm(spec).preset).toBe("openai");
  });

  test("OpenAI 호환 채팅: the address, the model and the token become the template", () => {
    const form = typed("openai", {
      url: "https://llm.internal/v1",
      model: "gpt-4o",
      token: "sk-1",
    });
    expect(configOf(spec, form)).toEqual({
      url: "https://llm.internal",
      startPath: "/v1/chat/completions",
      startBody: '{"model": "gpt-4o", "messages": [{"role": "user", "content": "{{prompt}}"}]}',
      replyPointer: "/choices/0/message/content",
      preset: "openai",
      model: "gpt-4o",
      token: "sk-1",
    });
  });

  test("the model name is safe inside the JSON body, and /chat/completions is not added twice", () => {
    const config = configOf(
      spec,
      typed("openai", { url: "https://x.test/v1/chat/completions", model: 'a"b' }),
    );
    expect(config.startPath).toBe("/v1/chat/completions");
    expect(JSON.parse(String(config.startBody).replace("{{prompt}}", "p")).model).toBe('a"b');
  });

  test("간단 JSON: one address, and the request and reply it promises", () => {
    const config = configOf(spec, typed("simple", { url: "https://agent.internal/ask?v=2" }));
    expect(config).toEqual({
      url: "https://agent.internal",
      startPath: "/ask?v=2",
      startBody: '{"prompt": "{{prompt}}", "tools": "{{mcpUrl}}"}',
      replyPointer: "/text",
      preset: "simple",
    });
    expect(configOf(spec, typed("simple", { url: "https://agent.internal" })).startPath).toBe("/");
  });

  test("only what the 고급 fold changed from its defaults is added on top of the preset", () => {
    const untouched = configOf(spec, typed("simple", { url: "https://a.test/x" }));
    expect(untouched.pollSeconds).toBeUndefined();
    const changed = configOf(
      spec,
      typed("simple", {
        url: "https://a.test/x",
        pollSeconds: "5",
        startBody: '{"q": "{{prompt}}"}',
      }),
    );
    expect(changed).toMatchObject({ pollSeconds: 5, startBody: '{"q": "{{prompt}}"}' });
    expect(advancedFields(spec, presetOf(spec, "simple") as never).map((f) => f.key)).toEqual([
      "token",
      "model",
      "startPath",
      "startBody",
      "pollSeconds",
    ]);
  });

  test("writing it by hand keeps today's behaviour: every field, nothing fixed", () => {
    const form = typed("", { url: "https://a.test", startPath: "/run" });
    expect(configOf(spec, form)).toMatchObject({
      url: "https://a.test",
      startPath: "/run",
      pollSeconds: 2,
    });
    expect(configOf(spec, form).preset).toBeUndefined();
  });

  test("what is missing is asked in the preset's own words; the connector's required url is not asked twice", () => {
    expect(formProblems(spec, typed("openai", { url: "", model: "" }))).toMatchObject({
      url: "주소를 적어 주세요",
      model: "모델 이름을(를) 적어 주세요",
    });
    expect(formProblems(spec, typed("openai", { url: "not a url", model: "m" })).url).toBe(
      "주소 형식이 맞지 않아요",
    );
    expect(
      formProblems({ ...spec, presets: undefined } as ConnectorSpec, typed("", { url: "" })).url,
    ).toBeDefined();
    expect(
      Object.keys(
        formProblems(spec, {
          ...typed("openai", { url: "https://a.test/v1", model: "m" }),
          name: "이름",
        }),
      ),
    ).toEqual([]);
    expect(
      presetProblems(
        presetOf(spec, "openai") as never,
        { url: "https://a.test", model: "m" },
        [],
        [],
      ),
    ).toEqual({});
  });

  test("a saved token counts as given, unless the person chose to remove it", () => {
    const preset = presetOf(spec, "openai") as never;
    expect(presetProblems(preset, { url: "https://a.test", model: "m" }, ["token"], [])).toEqual(
      {},
    );
    const withToken = {
      ...(preset as object),
      fields: [{ key: "token", label: "토큰", type: "secret", required: true }],
    } as never;
    expect(presetProblems(withToken, {}, [], [])).toHaveProperty("token");
    expect(presetProblems(withToken, {}, ["token"], ["token"])).toHaveProperty("token");
    expect(presetProblems(withToken, {}, ["token"], [])).toEqual({});
  });

  test("editing a saved connection shows the few questions again, with the address as it was typed", () => {
    const form = typed("openai", { url: "https://llm.internal:8000/v1", model: "gpt-4o" });
    const config = configOf(spec, form);
    const view = {
      name: "n",
      description: "",
      config,
      headers: [],
      metadata: {},
      traces: { kind: "none", config: {}, secrets: [] },
    } as unknown as ConnectionView;
    const back = formOf(spec, view);
    expect(back.preset).toBe("openai");
    expect(back.values.url).toBe("https://llm.internal:8000/v1");
    expect(back.values.model).toBe("gpt-4o");
    const plain = formOf(spec, { ...view, config: { url: "https://a.test", startPath: "/x" } });
    expect(plain.preset).toBe("");
    expect(plain.values.url).toBe("https://a.test");
  });

  test("addresses are split at the origin; a bad one is not split", () => {
    const urlPath = { into: "startPath", append: "/chat/completions" };
    expect(splitAddress("http://localhost:11434/v1/", urlPath)).toEqual({
      url: "http://localhost:11434",
      path: "/v1/chat/completions",
    });
    expect(splitAddress("nope", urlPath)).toBeUndefined();
    expect(
      typedUrl(presetOf(spec, "openai") as never, {
        url: "http://h",
        startPath: "/v1/chat/completions",
      }),
    ).toBe("http://h/v1");
    expect(presetSettings(presetOf(spec, "simple") as never, { url: "x" }).url).toBeUndefined();
  });
});
