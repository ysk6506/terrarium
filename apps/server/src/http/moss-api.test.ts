import { describe, expect, test } from "vitest";
import { testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

/** An OpenAI-style upstream whose chat answer is whatever the test hands in; it remembers the prompts. */
function setup(answer: (prompt: string) => string) {
  const prompts: string[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v1/models") return new Response(JSON.stringify({ data: [{ id: "small" }] }));
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
    const prompt = body.messages.map((m) => m.content).join("\n");
    prompts.push(prompt);
    return new Response(JSON.stringify({ choices: [{ message: { content: answer(prompt) } }] }));
  };
  const { platform } = testPlatform([], { llm: { fetch } });
  const app = buildApp({ platform });
  const send = async (method: string, url: string, payload?: object) => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: { "x-terrarium-user": "yeonsu" },
      ...(payload ? { payload } : {}),
    });
    return { status: r.statusCode, body: r.json() };
  };
  return { platform, send, prompts };
}

const model = {
  kind: "openai",
  name: "작은 모델",
  baseUrl: "https://llm.corp.test",
  apiKey: "sk-test-1234",
};
const ask = {
  screen: "run",
  question: "효율 점수는 왜 과제를 푼 만큼만 줘요?",
  state: { 점수: "30점" },
  actions: [{ id: "run-read-scores", label: "점수표 읽어 주기" }],
};

describe("POST /api/moss/ask answers from the docs and the screen state [REQ-103]", () => {
  test("without a default model it is 409 with reason no_model and the way out, and nothing is guessed", async () => {
    const { send, platform, prompts } = setup(() => "{}");
    const r = await send("POST", "/api/moss/ask", ask);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "no_model", reason: "no_model" });
    expect(JSON.stringify(r.body)).toContain("모델을 등록");
    expect(prompts).toEqual([]);
    await platform.stop();
  });

  test("with a default model the answer has sources from the repo docs, only registered actions, and the prompt carries docs and the state JSON", async () => {
    const { send, platform, prompts } = setup((prompt) => {
      const id = /\[(docs\/[^\]]+)\]/.exec(prompt)?.[1] ?? "";
      return JSON.stringify({
        answer: "푼 만큼만 점수를 줘요. 그래서 빨리 끝내도 0점일 수 있어요.",
        sources: [id, "state"],
        suggestedActions: ["run-read-scores", "not-registered"],
        followUps: ["기준선이 뭐예요?"],
      });
    });
    await send("POST", "/api/models", model);
    const r = await send("POST", "/api/moss/ask", ask);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      answered: true,
      model: "작은 모델",
      suggestedActions: ["run-read-scores"],
      followUps: ["기준선이 뭐예요?"],
    });
    expect(
      r.body.sources.some(
        (s: { kind: string; file?: string }) => s.kind === "doc" && s.file?.startsWith("docs/"),
      ),
    ).toBe(true);
    expect(r.body.sources).toContainEqual({ kind: "state" });
    expect(prompts[0]).toContain('"점수":"30점"');
    expect(prompts[0]).toContain("run-read-scores");
    await platform.stop();
  });

  test("a body without a question is a 400, and nothing is executed on the server: the reply is only data", async () => {
    const { send, platform } = setup(() => "{}");
    expect((await send("POST", "/api/moss/ask", { screen: "home" })).status).toBe(400);
    expect((await send("POST", "/api/moss/ask", { ...ask, extra: 1 })).status).toBe(400);
    await platform.stop();
  });
});
