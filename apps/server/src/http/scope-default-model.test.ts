/**
 * The model everyone's helper uses (ADR-0174, ADR-0179): only a model made for everyone can be it, so no one's private key is
 * spent for another person; what one person gets as the default is everyone's, else the first model they may see.
 */
import { describe, expect, test } from "vitest";
import { BOSS, MINA, OLIVIA, OMAR, scopedApp } from "./test-support/scoped-app";

const model = (name: string, extra: object = {}) => ({
  name,
  kind: "openai",
  baseUrl: "https://llm.test/v1",
  apiKey: `sk-${name}-secret-0001`,
  ...extra,
});

type Row = { id: string; name: string; isDefault: boolean };
const rows = async (s: ReturnType<typeof scopedApp>, who: typeof OLIVIA) =>
  (await s.send(who, "GET", "/api/models")).body as unknown as Row[];

describe("[REQ-054] the default model is a model made for everyone", () => {
  test("[REQ-054] someone's private model that is the only one is no one else's default, and no one else can use it", async () => {
    const s = scopedApp();
    const mine = (await s.send(OLIVIA, "POST", "/api/models", model("올리비아"))).body;
    // her own list shows it as her default; nobody else sees it at all
    expect((await rows(s, OLIVIA)).find((m) => m.id === mine.id)?.isDefault).toBe(true);
    expect(await rows(s, OMAR)).toEqual([]);
    for (const who of [OMAR, MINA])
      expect((await s.send(who, "POST", `/api/models/${mine.id}/check`)).status).toBe(404);
    // the helper of someone else has no model, so no key is spent: no call goes out with hers
    s.llmCalls.length = 0;
    const ask = await s.send(OMAR, "POST", "/api/moss/ask", {
      screen: "home",
      question: "안녕",
      state: {},
      actions: [],
    });
    expect(ask.status).toBe(409);
    expect(s.llmCalls).toEqual([]);
    // hers goes out with her own key, as it did when one person used it alone
    await s.send(OLIVIA, "POST", "/api/moss/ask", {
      screen: "home",
      question: "안녕",
      state: {},
      actions: [],
    });
    expect(s.llmCalls.join(" ")).toContain("sk-올리비아");
    await s.close();
  });

  test("[REQ-054] the first model made for everyone becomes the default, whoever registered the private ones before it", async () => {
    const s = scopedApp();
    await s.send(OLIVIA, "POST", "/api/models", model("나만"));
    const shared = (
      await s.send(OLIVIA, "POST", "/api/models", model("모두", { scope: "everyone" }))
    ).body;
    for (const who of [OLIVIA, MINA, OMAR])
      expect((await rows(s, who)).find((m) => m.isDefault)?.id, who.login).toBe(shared.id);
    expect((await s.send(OMAR, "POST", `/api/models/${shared.id}/check`)).status).toBe(200);
    await s.close();
  });

  test("[REQ-054] a private or group model cannot be chosen as the default, and the default cannot be narrowed", async () => {
    const s = scopedApp();
    const open = (await s.send(OLIVIA, "POST", "/api/models", model("모두", { scope: "everyone" })))
      .body;
    const closed = (await s.send(OLIVIA, "POST", "/api/models", model("나만"))).body;
    const refused = await s.send(OLIVIA, "POST", `/api/models/${closed.id}/default`);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toContain("모두");
    const narrow = await s.send(OLIVIA, "PUT", `/api/models/${open.id}/scope`, {
      scope: "private",
    });
    expect(narrow.status).toBe(400);
    expect(narrow.body.error.message).toContain("먼저 다른 모델을 기본으로 정해 주세요");
    // once another one made for everyone is the default, the first may be narrowed
    const second = (
      await s.send(OLIVIA, "POST", "/api/models", model("둘째", { scope: "everyone" }))
    ).body;
    expect((await s.send(OLIVIA, "POST", `/api/models/${second.id}/default`)).status).toBe(200);
    expect(
      (await s.send(OLIVIA, "PUT", `/api/models/${open.id}/scope`, { scope: "private" })).status,
    ).toBe(200);
    await s.close();
  });

  test("[REQ-054] only an admin or the model's maker chooses it; deleting the default hands it to the first one made for everyone", async () => {
    const s = scopedApp();
    const a = (await s.send(OLIVIA, "POST", "/api/models", model("가", { scope: "everyone" })))
      .body;
    await s.send(OLIVIA, "POST", "/api/models", model("사적"));
    const c = (await s.send(OMAR, "POST", "/api/models", model("다", { scope: "everyone" }))).body;
    expect((await s.send(MINA, "POST", `/api/models/${c.id}/default`)).status).toBe(403);
    expect((await s.send(OMAR, "POST", `/api/models/${c.id}/default`)).status).toBe(200);
    expect((await s.send(BOSS, "POST", `/api/models/${a.id}/default`)).status).toBe(200);
    expect((await s.send(OLIVIA, "DELETE", `/api/models/${a.id}`)).status).toBe(200);
    expect((await rows(s, MINA)).find((m) => m.isDefault)?.id).toBe(c.id);
    // with no model made for everyone left, there is no default for everyone, only what each person may see
    expect((await s.send(OMAR, "DELETE", `/api/models/${c.id}`)).status).toBe(200);
    expect((await rows(s, MINA)).find((m) => m.isDefault)).toBeUndefined();
    expect((await rows(s, OLIVIA)).find((m) => m.isDefault)?.name).toBe("사적");
    await s.close();
  });

  test("[REQ-054] an admin's own default does not fall on someone else's private model", async () => {
    const s = scopedApp();
    await s.send(OLIVIA, "POST", "/api/models", model("올리비아"));
    expect((await rows(s, BOSS)).find((m) => m.isDefault)).toBeUndefined();
    await s.close();
  });
});
