import { describe, expect, test } from "vitest";
import { person, testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

describe("saved instructions, tool sets and runbooks over HTTP [REQ-090] [REQ-080] [REQ-082]", () => {
  test("save, list, rename, delete and bring back; the same name changes the one it names", async () => {
    const { platform } = testPlatform();
    const a = buildApp({ platform });
    const send = async (method: string, url: string, payload?: object, who = "yeonsu") => {
      const r = await a.inject({
        method: method as "GET",
        url,
        headers: { "x-terrarium-user": who },
        ...(payload ? { payload } : {}),
      });
      return { status: r.statusCode, body: r.json() };
    };
    const first = await send("POST", "/api/presets", {
      kind: "instruction",
      name: "권장",
      body: "5분마다 봐요",
    });
    expect(first.status).toBe(200);
    const again = await send("POST", "/api/presets", {
      kind: "instruction",
      name: "권장",
      body: "1분마다 봐요",
    });
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.body).toBe("1분마다 봐요");
    await send("POST", "/api/presets", { kind: "toolset", name: "냉방만", body: '["wait"]' });
    const all = await send("GET", "/api/presets");
    expect(all.body.presets.map((p: { name: string }) => p.name).sort()).toEqual([
      "권장",
      "냉방만",
    ]);
    const only = await send("GET", "/api/presets?kind=toolset");
    expect(only.body.presets.map((p: { kind: string }) => p.kind)).toEqual(["toolset"]);

    const renamed = await send("PUT", `/api/presets/${first.body.id}`, { name: "새 이름" });
    expect(renamed.body.name).toBe("새 이름");
    const clash = await send("POST", "/api/presets", {
      kind: "instruction",
      name: "다른",
      body: "x",
    });
    expect((await send("PUT", `/api/presets/${clash.body.id}`, { name: "새 이름" })).status).toBe(
      409,
    );

    expect((await send("DELETE", `/api/presets/${first.body.id}`)).body).toEqual({ deleted: true });
    const after = await send("GET", "/api/presets?kind=instruction");
    expect(after.body.presets.map((p: { name: string }) => p.name)).toEqual(["다른"]);
    expect(after.body.deleted.map((p: { name: string }) => p.name)).toEqual(["새 이름"]);
    const back = await send("POST", `/api/presets/${first.body.id}/restore`);
    expect(back.body.deletedAt).toBeUndefined();
    await platform.stop();
  });

  test("they are the person's own; a body that does not fit its kind is refused", async () => {
    const { platform } = testPlatform();
    const a = buildApp({ platform });
    const send = async (method: string, url: string, payload?: object, who = "yeonsu") => {
      const r = await a.inject({
        method: method as "GET",
        url,
        headers: { "x-terrarium-user": who },
        ...(payload ? { payload } : {}),
      });
      return { status: r.statusCode, body: r.json() };
    };
    const mine = await send("POST", "/api/presets", { kind: "toolset", name: "내 것", body: "[]" });
    expect((await send("GET", "/api/presets", undefined, "jimin")).body.presets).toEqual([]);
    expect((await send("DELETE", `/api/presets/${mine.body.id}`, undefined, "jimin")).status).toBe(
      404,
    );
    expect(
      (await send("POST", "/api/presets", { kind: "toolset", name: "깨짐", body: "{not json" }))
        .status,
    ).toBe(400);
    expect(
      (await send("POST", "/api/presets", { kind: "runbook", name: "단계 없음", body: "{}" }))
        .status,
    ).toBe(400);
    expect(
      (await send("POST", "/api/presets", { kind: "poem", name: "시", body: "x" })).status,
    ).toBe(400);
    await platform.stop();
  });

  test("what an older browser kept is taken once, skipping names already there", async () => {
    const { platform } = testPlatform();
    const a = buildApp({ platform });
    const post = async (items: object[]) =>
      (
        await a.inject({
          method: "POST",
          url: "/api/presets/import",
          headers: { "x-terrarium-user": "yeonsu" },
          payload: { items },
        })
      ).json();
    const items = [
      { kind: "toolset", name: "냉방만", body: '["wait"]', createdAt: "2026-11-01T09:00:00Z" },
      { kind: "instruction", name: "권장", body: "복구 먼저" },
      { kind: "runbook", name: "깨진 절차", body: "[]" },
    ];
    const first = await post(items);
    expect(first.presets.map((p: { name: string }) => p.name).sort()).toEqual(
      ["권장", "냉방만"].sort(),
    );
    const second = await post(items);
    expect(second.presets).toHaveLength(2);
    expect(second.presets.find((p: { name: string }) => p.name === "냉방만").createdAt).toBe(
      "2026-11-01T09:00:00Z",
    );
    await platform.stop();
  });
  test("a deleted one is kept for seven days and then forgotten", async () => {
    const { platform, store } = testPlatform();
    const base = {
      owner: "yeonsu",
      kind: "instruction" as const,
      body: "x",
      createdAt: "2026-09-01T00:00:00Z",
    };
    await store.putPreset({
      ...base,
      id: "p-old",
      name: "오래전",
      deletedAt: "2026-10-01T00:00:00Z",
    });
    await store.putPreset({
      ...base,
      id: "p-new",
      name: "어제",
      deletedAt: "2026-10-28T12:00:00Z",
    });
    const listed = await platform.presets.list(person("yeonsu"));
    expect(listed.deleted.map((p) => p.name)).toEqual(["어제"]);
    expect(await store.getPreset("p-old")).toBeUndefined();
    await platform.stop();
  });
});
