import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { SqliteStore } from "../adapters";
import { testPlatform, until, YEONSU } from "../runtime/test-support/platform";
import { buildApp } from "./app";

function setup() {
  const { platform, store } = testPlatform();
  const app = buildApp({ platform });
  const send = async (method: string, url: string, payload?: object, who = "yeonsu") => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: { "x-terrarium-user": encodeURIComponent(who) },
      ...(payload ? { payload } : {}),
    });
    return { status: r.statusCode, body: r.json() };
  };
  return { platform, store, send };
}

describe("서비스 카드 [REQ-104]", () => {
  test("[REQ-104] 처음엔 잠김·공유 안 함이고, 남에게는 공유한 뒤에만 보인다", async () => {
    const { send } = setup();
    const made = await send("POST", "/api/service-cards", { name: "내 캐시", card: "cache" });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ shared: false, owner: "yeonsu", canEdit: true });
    expect(made.body).not.toHaveProperty("locked");
    expect((await send("GET", "/api/service-cards", undefined, "jimin")).body).toEqual([]);
    expect((await send("GET", "/api/service-cards")).body).toHaveLength(1);
    await send("PATCH", `/api/service-cards/${made.body.id}`, { shared: true });
    const seen = await send("GET", "/api/service-cards", undefined, "jimin");
    expect(seen.body).toHaveLength(1);
    expect(seen.body[0]).toMatchObject({ canEdit: false, owner: "yeonsu" });
  });

  test("[REQ-108] 카드는 늘 잠겨 있다: 만든 사람만 고치고 지우고, 잠금 옵션은 받지 않는다", async () => {
    const { send } = setup();
    const id = (
      await send("POST", "/api/service-cards", { name: "큐", card: "message-queue", shared: true })
    ).body.id;
    const url = `/api/service-cards/${id}`;
    expect((await send("PATCH", url, { name: "바꿈" }, "jimin")).status).toBe(403);
    expect((await send("DELETE", url, undefined, "jimin")).status).toBe(403);
    // `locked` is gone: asking for it is a mistake, not a way to open the card
    expect((await send("PATCH", url, { locked: false })).status).toBe(400);
    expect(
      (await send("POST", "/api/service-cards", { name: "x", card: "cache", locked: false }))
        .status,
    ).toBe(400);
    expect((await send("PATCH", url, { name: "바꿈" }, "jimin")).status).toBe(403);
    expect((await send("PATCH", url, { name: "내가 고침" })).body.name).toBe("내가 고침");
    expect((await send("DELETE", url)).body).toEqual({ deleted: true });
  });

  test("[REQ-108] 남의 공유 카드는 복사해서 내 카드로 쓴다: 복사본은 복사한 사람의 것이고 공유하지 않은 채 시작한다", async () => {
    const { send } = setup();
    const made = await send("POST", "/api/service-cards", {
      name: "큐",
      card: "message-queue",
      shared: true,
    });
    const url = `/api/service-cards/${made.body.id}/copy`;
    const copy = await send("POST", url, { name: "지민의 큐" }, "jimin");
    expect(copy.status).toBe(200);
    expect(copy.body).toMatchObject({
      name: "지민의 큐",
      card: "message-queue",
      owner: "jimin",
      shared: false,
      canEdit: true,
    });
    expect(copy.body.id).not.toBe(made.body.id);
    // the copy is the copier's to change; the original is still the maker's
    expect(
      (await send("PATCH", `/api/service-cards/${copy.body.id}`, { shared: true }, "jimin")).status,
    ).toBe(200);
    expect(
      (await send("PATCH", `/api/service-cards/${made.body.id}`, { name: "x" }, "jimin")).status,
    ).toBe(403);
    // a card that is not shared cannot be copied by somebody else
    const hidden = await send("POST", "/api/service-cards", { name: "비공개", card: "cache" });
    expect(
      (await send("POST", `/api/service-cards/${hidden.body.id}/copy`, {}, "jimin")).status,
    ).toBe(403);
    // a copy without a name keeps the name
    expect((await send("POST", url, {}, "jimin")).body.name).toBe("큐");
  });

  test("[REQ-104] 없는 기본 카드와 등급 수가 다른 피해는 막힌다", async () => {
    const { send } = setup();
    expect((await send("POST", "/api/service-cards", { name: "x", card: "nope" })).status).toBe(
      400,
    );
    const bad = await send("POST", "/api/service-cards", {
      name: "x",
      card: "cache",
      harm: [{ name: "a", perHourKrw: 1 }],
    });
    expect(bad.status).toBe(400);
  });
});

describe("빠른 실험 [REQ-104]", () => {
  test("[REQ-104] 한 번의 요청으로 시나리오 세트 운영 실험이 5번 만들어지고 내장 operator를 쓴다", async () => {
    const { platform, send, store } = setup();
    const { world } = await platform.worlds.create(YEONSU, {
      name: "샘플 홀",
      blueprint: sampleBlueprint(),
    });
    const res = await send("POST", `/api/worlds/${world.id}/quick-experiment`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      runs: 5,
      harnessId: "builtin",
      agentId: "operator",
      agentFrom: "builtin",
    });
    expect(res.body.scenarios).toBeGreaterThan(0);
    const e = await store.getExperiment(res.body.experimentId);
    expect(e?.recipe.seeds).toEqual([1, 2, 3, 4, 5]);
    expect(e?.recipe.operation?.source.kind).toBe("set");
    expect(e?.recipe.operation?.pace).toEqual({ mode: "realtime" });
    await until(async () => (await store.listRuns(res.body.experimentId)).length === 5);
  });

  test("[REQ-104] 다음 번에는 방금 쓴 에이전트를 고른다", async () => {
    const { platform, send } = setup();
    const { world } = await platform.worlds.create(YEONSU, {
      name: "샘플 홀",
      blueprint: sampleBlueprint(),
    });
    await send("POST", `/api/worlds/${world.id}/quick-experiment`, {});
    const again = await send("POST", `/api/worlds/${world.id}/quick-experiment`, {});
    expect(again.body.agentFrom).toBe("recent");
  });

  test("[REQ-104] 화면이 고른 시나리오만 쓰고, 하나도 없으면 막는다", async () => {
    const { platform, send } = setup();
    const { world } = await platform.worlds.create(YEONSU, {
      name: "샘플 홀",
      blueprint: sampleBlueprint(),
    });
    const one = await send("POST", `/api/worlds/${world.id}/quick-experiment`, {
      templateIds: ["cooling-failure"],
    });
    expect(one.body.scenarios).toBe(1);
    const none = await send("POST", `/api/worlds/${world.id}/quick-experiment`, {
      templateIds: ["no-such"],
    });
    expect(none.status).toBe(400);
  });
});

describe("서비스 카드 저장 [REQ-104]", () => {
  test("[REQ-104] SQLite에 저장하고 다시 열어도 카드가 남고, 지우면 사라진다", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cards-"));
    try {
      const file = path.join(dir, "terrarium.db");
      const first = new SqliteStore(file);
      const one = testPlatform([], {}, first);
      const made = await one.platform.serviceCards.create(YEONSU, {
        name: "내 큐",
        card: "message-queue",
        shared: true,
      });
      first.close();
      const second = new SqliteStore(file);
      const two = testPlatform([], {}, second);
      expect((await two.platform.serviceCards.list(YEONSU)).map((c) => c.id)).toEqual([made.id]);
      await two.platform.serviceCards.remove(YEONSU, made.id);
      expect(await two.platform.serviceCards.list(YEONSU)).toEqual([]);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
