import type { Experiment, RunRecord } from "@terrarium/core/experiments";
import { DEFAULT_SHAPE } from "@terrarium/core/sources/worldgen";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { HANEUL, JIMIN, testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

// The test clock starts at 2026-10-29 and ticks a second per stamp, so "now" is that day.
const RECENT = "2026-10-28T00:00:00.000Z";
const THIS_MONTH = "2026-10-10T00:00:00.000Z";
const OLD = "2026-08-01T00:00:00.000Z";

function setup() {
  const { platform, store } = testPlatform();
  const app = buildApp({ platform });
  const send = async (method: string, url: string, who: string | null = "haneul") => {
    const r = await app.inject({
      method: method as "GET",
      url,
      ...(who !== null ? { headers: { "x-terrarium-user": encodeURIComponent(who) } } : {}),
    });
    return { status: r.statusCode, body: r.json() };
  };
  return { platform, store, send };
}

let n = 0;
function experiment(owner: string, worldId: string, scenarioId: string, createdAt: string) {
  n += 1;
  return {
    id: `x-${n}`,
    name: `실험 ${n}`,
    owner,
    createdAt,
    recipe: { worldId, scenarioId, harnessId: "builtin", agentId: "a", tools: [], seeds: [1] },
    snapshot: {},
    benchmarkKey: `k-${n}`,
  } as unknown as Experiment;
}

const world = (p: ReturnType<typeof setup>["platform"], who: typeof HANEUL, name: string) =>
  p.worlds.create(who, { name, blueprint: sampleBlueprint() }).then((r) => r.world);

describe("세계 인기 순서와 근거 [REQ-101]", () => {
  test("[REQ-101] 인기는 최근 30일 실험 + 좋아요 + 남이 시작한 수이고, 카드가 근거를 싣고 온다", async () => {
    const { platform, store, send } = setup();
    const a = await world(platform, HANEUL, "가");
    const b = await world(platform, JIMIN, "나");
    const c = await world(platform, JIMIN, "다");
    // 가: 한 달 안 1번 · 나: 이번 주 2번 + 한 달 안 1번 + 한 달 밖 5번 · 다: 한 달 밖 1번뿐
    await store.putExperiment(experiment("jimin", a.id, "s", THIS_MONTH));
    for (const at of [RECENT, RECENT, THIS_MONTH])
      await store.putExperiment(experiment("haneul", b.id, "s", at));
    for (let i = 0; i < 5; i += 1) await store.putExperiment(experiment("haneul", b.id, "s", OLD));
    await store.putExperiment(experiment("haneul", c.id, "s", OLD));
    expect((await send("POST", `/api/worlds/${a.id}/like`, "jimin")).status).toBe(200);

    const list = (await send("GET", "/api/worlds")).body as Array<{
      id: string;
      stats: Record<string, number>;
      likes: number;
      likedByMe: boolean;
    }>;
    expect(list.map((w) => w.id)).toEqual([b.id, a.id, c.id]);
    expect(list[0]?.stats).toMatchObject({ experiments30d: 3, experiments: 8, score: 3, week: 2 });
    expect(list[1]).toMatchObject({ likes: 1, likedByMe: false });
    expect(list[1]?.stats).toMatchObject({ experiments30d: 1, likes: 1, score: 2, week: 1 });
    expect(list[2]?.stats.score).toBe(0);
  });

  test("[REQ-101] 정렬은 넷: 인기·요즘 활발·새로 생김·내 세계, 비슷하면 나중에 생긴 것이 앞이다", async () => {
    const { platform, store, send } = setup();
    const a = await world(platform, HANEUL, "가");
    const b = await world(platform, JIMIN, "나");
    const c = await world(platform, JIMIN, "다");
    await store.putExperiment(experiment("haneul", a.id, "s", THIS_MONTH));
    await store.putExperiment(experiment("haneul", a.id, "s", THIS_MONTH));
    await store.putExperiment(experiment("haneul", b.id, "s", RECENT));
    const ids = async (sort?: string, who = "haneul") =>
      (
        (await send("GET", `/api/worlds${sort ? `?sort=${sort}` : ""}`, who)).body as {
          id: string;
        }[]
      ).map((w) => w.id);
    // 인기: 가(2) → 나(1) → 다(0)
    expect(await ids()).toEqual([a.id, b.id, c.id]);
    expect(await ids("popular")).toEqual([a.id, b.id, c.id]);
    // 요즘 활발: 이번 주 활동만 센다. 나(1)이 앞서고 가·다(0)는 나중에 생긴 다가 앞
    expect(await ids("active")).toEqual([b.id, c.id, a.id]);
    expect(await ids("new")).toEqual([c.id, b.id, a.id]);
    expect(await ids("mine")).toEqual([a.id]);
    expect(await ids("mine", "jimin")).toHaveLength(2);
    expect((await send("GET", "/api/worlds?sort=best")).status).toBe(400);
  });

  test("[REQ-101] 같은 점수는 만든 때로 가르고, 몇 번을 읽어도 같은 순서다", async () => {
    const { platform, send } = setup();
    const ws = [await world(platform, HANEUL, "가"), await world(platform, HANEUL, "나")];
    const first = ((await send("GET", "/api/worlds")).body as { id: string }[]).map((w) => w.id);
    const again = ((await send("GET", "/api/worlds")).body as { id: string }[]).map((w) => w.id);
    expect(first).toEqual([ws[1]?.id, ws[0]?.id]);
    expect(again).toEqual(first);
  });

  test("[REQ-101] 템플릿이나 세계로 시작한 세계는 그 출처를 기록하고, 남이 시작한 것만 점수에 든다", async () => {
    const { platform, send } = setup();
    const tpl = await platform.worlds.generate(HANEUL, {
      shape: { ...DEFAULT_SHAPE, servers: 24 },
      template: true,
    });
    const mine = await platform.worlds.generate(HANEUL, {
      shape: { ...DEFAULT_SHAPE, servers: 24 },
      startedFrom: tpl.world.id,
    });
    const theirs = await platform.worlds.generate(JIMIN, {
      shape: { ...DEFAULT_SHAPE, servers: 24 },
      startedFrom: tpl.world.id,
    });
    const stray = await platform.worlds.generate(JIMIN, {
      shape: { ...DEFAULT_SHAPE, servers: 24 },
      startedFrom: "w-없음",
    });
    expect(mine.world.startedFrom).toBe(tpl.world.id);
    expect(theirs.world.startedFrom).toBe(tpl.world.id);
    expect(stray.world.startedFrom).toBeUndefined();
    // 템플릿은 목록에 없으니 카드로는 안 나오고, 세계에서 시작한 세계는 그 세계의 점수에 든다
    const next = await platform.worlds.generate(JIMIN, {
      shape: { ...DEFAULT_SHAPE, servers: 24 },
      startedFrom: mine.world.id,
    });
    const list = (await send("GET", "/api/worlds")).body as {
      id: string;
      stats: { startedByOthers: number; score: number };
    }[];
    expect(list.find((w) => w.id === tpl.world.id)).toBeUndefined();
    expect(list.find((w) => w.id === mine.world.id)?.stats).toMatchObject({
      startedByOthers: 1,
      score: 1,
    });
    expect(list[0]?.id).toBe(mine.world.id);
    expect(next.world.startedFrom).toBe(mine.world.id);
  });
});

describe("좋아요 [REQ-101]", () => {
  test("[REQ-101] 사람마다 세계마다 하나, 다시 눌러도 하나, 취소하면 줄고, 목록에 개수와 내 것이 실린다", async () => {
    const { platform, send } = setup();
    const w = await world(platform, HANEUL, "가");
    expect((await send("POST", `/api/worlds/${w.id}/like`, "jimin")).body).toEqual({
      worldId: w.id,
      likes: 1,
      likedByMe: true,
    });
    expect((await send("POST", `/api/worlds/${w.id}/like`, "jimin")).body).toMatchObject({
      likes: 1,
    });
    expect((await send("POST", `/api/worlds/${w.id}/like`)).body).toMatchObject({
      likes: 2,
      likedByMe: true,
    });
    const asJimin = (await send("GET", "/api/worlds", "jimin")).body as {
      likes: number;
      likedByMe: boolean;
    }[];
    expect(asJimin[0]).toMatchObject({ likes: 2, likedByMe: true });
    expect((await send("DELETE", `/api/worlds/${w.id}/like`, "jimin")).body).toMatchObject({
      likes: 1,
      likedByMe: false,
    });
    expect((await send("DELETE", `/api/worlds/${w.id}/like`, "jimin")).body).toMatchObject({
      likes: 1,
    });
    const text = JSON.stringify((await send("GET", "/api/worlds")).body);
    expect(text).not.toContain("jimin");
  });

  test("[REQ-101] 없는 세계는 404, 이름이 없는 사람은 403이고 아무것도 남지 않는다", async () => {
    const { platform, send } = setup();
    const w = await world(platform, HANEUL, "가");
    expect((await send("POST", "/api/worlds/w-없음/like")).status).toBe(404);
    const anon = await send("POST", `/api/worlds/${w.id}/like`, null);
    expect(anon.status).toBe(403);
    expect(((await send("GET", "/api/worlds")).body as { likes: number }[])[0]?.likes).toBe(0);
  });
});

const run = (experimentId: string, passed: boolean, at: string) =>
  ({
    id: `r-${experimentId}`,
    experimentId,
    index: 0,
    seed: 1,
    status: "completed",
    queuedAt: at,
    finishedAt: at,
    result: { score: { passed, total: passed ? 90 : 10 } },
  }) as unknown as RunRecord;

describe("칭호 [REQ-101]", () => {
  const titlesOf = async (send: ReturnType<typeof setup>["send"], user: string) =>
    (
      (await send("GET", `/api/users/${encodeURIComponent(user)}/titles`)).body as {
        titles: { key: string; label: string; earnedAt: string }[];
      }
    ).titles;

  test("[REQ-101] 세계를 만들면 첫 세계, 아무것도 안 한 사람은 칭호가 없다", async () => {
    const { platform, send } = setup();
    const w = await world(platform, HANEUL, "가");
    const mine = await titlesOf(send, "haneul");
    expect(mine.map((t) => t.label)).toEqual(["첫 세계"]);
    expect(mine[0]?.earnedAt).toBe(w.createdAt);
    expect(await titlesOf(send, "아무개")).toEqual([]);
  });

  test("[REQ-101] 실험 100번·1,000번은 만든 실험 수이고, 얻은 때는 그 번째 실험을 만든 때다", async () => {
    const { platform, store, send } = setup();
    const w = await world(platform, HANEUL, "가");
    for (let i = 0; i < 100; i += 1)
      await store.putExperiment(
        experiment(
          "하늘",
          w.id,
          "s",
          `2026-10-${String(10 + (i % 10)).padStart(2, "0")}T00:00:00.000Z`,
        ),
      );
    for (let i = 0; i < 99; i += 1)
      await store.putExperiment(experiment("지민", w.id, "s", RECENT));
    const t = await titlesOf(send, "하늘");
    expect(t.map((x) => x.label)).toEqual(["실험 100번"]);
    expect(t[0]?.earnedAt).toBe("2026-10-19T00:00:00.000Z");
    expect((await titlesOf(send, "지민")).map((x) => x.label)).toEqual([]);
  });

  test("[REQ-101] 남이 쓰는 세계와 남이 쓰는 시나리오는 다른 사람의 실험 10번부터, 내 실험은 세지 않는다", async () => {
    const { platform, store, send } = setup();
    const w = await world(platform, HANEUL, "가");
    const { scenario } = await platform.scenarios.create(HANEUL, {
      worldId: w.id,
      templateId: "cooling-failure",
    });
    for (let i = 0; i < 9; i += 1)
      await store.putExperiment(experiment("jimin", w.id, scenario.id, RECENT));
    for (let i = 0; i < 20; i += 1)
      await store.putExperiment(experiment("haneul", w.id, scenario.id, RECENT));
    expect((await titlesOf(send, "haneul")).map((t) => t.label)).toEqual(["첫 세계"]);
    await platform.worlds.create(HANEUL, { name: "깨우기", blueprint: sampleBlueprint() });
    await store.putExperiment(experiment("minho", w.id, scenario.id, RECENT));
    await platform.worlds.create(HANEUL, { name: "또 깨우기", blueprint: sampleBlueprint() });
    expect((await titlesOf(send, "haneul")).map((t) => t.label)).toEqual([
      "남이 쓰는 시나리오",
      "남이 쓰는 세계",
      "첫 세계",
    ]);
  });

  test("[REQ-101] 첫 복구는 에이전트가 내 시나리오를 처음 통과했을 때, 떨어진 것은 안 센다", async () => {
    const { platform, store, send } = setup();
    const w = await world(platform, HANEUL, "가");
    const { scenario } = await platform.scenarios.create(HANEUL, {
      worldId: w.id,
      templateId: "cooling-failure",
    });
    const failed = experiment("jimin", w.id, scenario.id, RECENT);
    const passed = experiment("jimin", w.id, scenario.id, THIS_MONTH);
    await store.putExperiment(failed);
    await store.putExperiment(passed);
    await store.putRun(run(failed.id, false, "2026-10-28T09:00:00.000Z"));
    expect((await titlesOf(send, "haneul")).map((t) => t.key)).toEqual(["first-world"]);
    await store.putRun(run(passed.id, true, "2026-10-12T09:00:00.000Z"));
    await platform.worlds.create(HANEUL, { name: "깨우기", blueprint: sampleBlueprint() });
    const t = await titlesOf(send, "haneul");
    expect(t.find((x) => x.key === "first-recovery")?.earnedAt).toBe("2026-10-12T09:00:00.000Z");
  });

  test("[REQ-101] 변별력 점검: 점검하면 기록이 남고, 고칠 곳이 없던 시나리오 5개가 꼼꼼한 출제자다", async () => {
    const { platform, store, send } = setup();
    const w = await world(platform, HANEUL, "가");
    const { scenario } = await platform.scenarios.create(HANEUL, {
      worldId: w.id,
      templateId: "cooling-failure",
    });
    await platform.scenarios.calibrate(HANEUL, scenario.id, 1);
    const marks = await store.listCalibrationMarks();
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ scenarioId: scenario.id, digest: scenario.digest });
    for (let i = 0; i < 5; i += 1) {
      const s = await platform.scenarios.create(HANEUL, {
        worldId: w.id,
        templateId: "cooling-failure",
      });
      await store.putCalibrationMark({
        scenarioId: s.scenario.id,
        digest: "d",
        at: `2026-10-0${i + 1}T00:00:00.000Z`,
        clean: i !== 4,
      });
    }
    expect((await titlesOf(send, "haneul")).map((t) => t.key)).not.toContain("careful-author");
    const last = await platform.scenarios.create(HANEUL, {
      worldId: w.id,
      templateId: "cooling-failure",
    });
    await store.putCalibrationMark({
      scenarioId: last.scenario.id,
      digest: "d",
      at: "2026-10-07T00:00:00.000Z",
      clean: true,
    });
    await platform.worlds.create(HANEUL, { name: "깨우기", blueprint: sampleBlueprint() });
    const t = await titlesOf(send, "haneul");
    expect(t.find((x) => x.key === "careful-author")?.earnedAt).toBe("2026-10-07T00:00:00.000Z");
  });

  test("[REQ-101] 좋아요 10은 다른 사람이 누른 것만 세고, 한 번 얻은 칭호는 세계를 지워도 남는다", async () => {
    const { platform, send } = setup();
    const w = await world(platform, HANEUL, "가");
    await send("POST", `/api/worlds/${w.id}/like`, "haneul");
    for (let i = 0; i < 9; i += 1) await send("POST", `/api/worlds/${w.id}/like`, `사람${i}`);
    expect((await titlesOf(send, "haneul")).map((t) => t.key)).toEqual(["first-world"]);
    await send("POST", `/api/worlds/${w.id}/like`, "사람9");
    expect((await titlesOf(send, "haneul")).map((t) => t.label)).toEqual(["좋아요 10", "첫 세계"]);
    await platform.worlds.delete(HANEUL, w.id);
    expect((await titlesOf(send, "haneul")).map((t) => t.label)).toEqual(["좋아요 10", "첫 세계"]);
  });

  test("[REQ-101] 만든 사람의 칭호가 세계 카드와 실험 목록에 같이 온다", async () => {
    const { platform, store, send } = setup();
    const w = await world(platform, HANEUL, "가");
    await store.putExperiment(experiment("haneul", w.id, "s", RECENT));
    const cards = (await send("GET", "/api/worlds")).body as { ownerTitles: { label: string }[] }[];
    expect(cards[0]?.ownerTitles.map((t) => t.label)).toEqual(["첫 세계"]);
    const experiments = (await send("GET", "/api/experiments")).body as {
      ownerTitles?: { label: string }[];
    }[];
    expect(experiments[0]?.ownerTitles?.map((t) => t.label)).toEqual(["첫 세계"]);
  });

  test("[REQ-101] 템플릿과 예시 세계는 첫 세계로 세지 않는다", async () => {
    const { platform, send } = setup();
    await platform.worlds.generate(HANEUL, {
      shape: { ...DEFAULT_SHAPE, servers: 24 },
      template: true,
    });
    expect(await titlesOf(send, "haneul")).toEqual([]);
  });
});
