import { describe, expect, test } from "vitest";
import { HANEUL, testPlatform } from "./test-support/platform";

describe("a registered model whose sealed key cannot be opened says so instead of failing [REQ-099]", () => {
  test("the check answers not ok with a reason in words, and keeps that on the record", async () => {
    const { platform, store } = testPlatform([], {
      llm: { fetch: async () => new Response("{}", { status: 200 }) },
    });
    const made = await platform.models.create(HANEUL, {
      name: "게이트웨이",
      kind: "openai",
      baseUrl: "https://llm.example.com/v1",
      apiKey: "sk-live-abcdef-1234",
      headers: [],
    } as never);
    const record = await store.getModel(made.id);
    await store.putModel({
      ...(record as NonNullable<typeof record>),
      sealedKey: "garbage-not-sealed",
    });
    const checked = await platform.models.check(HANEUL, made.id);
    expect(checked.lastCheck).toMatchObject({
      ok: false,
      reason: "other",
      error: "저장한 키를 열 수 없어요. 키를 다시 넣어 주세요",
    });
    expect((await store.getModel(made.id))?.lastCheck?.ok).toBe(false);
  });
});
