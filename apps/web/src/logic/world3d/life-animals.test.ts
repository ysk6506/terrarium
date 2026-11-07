import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { Reactions } from "./animal-pose";
import { CAT_WALK_M, totalOf } from "./animal-react";
import { standable, TREE_SHARE, treesAt } from "./campus-plan";
import { type Agent, lifeOf, poseAt } from "./life";
import { siteScene } from "./site";

const catalog = new Catalog();
const site = siteScene(
  new BlueprintIndex(
    generateCampus(
      {
        ...DEFAULT_CAMPUS,
        site: "giheung",
        seed: 7,
        buildings: 3,
        floors: 2,
        hallsPerFloor: 2,
        podsPerHall: 6,
        detail: 0.3,
      },
      catalog,
    ).blueprint,
  ),
  catalog,
);
if (!site) throw new Error("no site");
const agents = lifeOf(site);

describe("고양이와 새는 풀밭에만 있다 [REQ-105]", () => {
  test("새가 2~3마리 있고 고양이도 있다", () => {
    const birds = agents.filter((a) => a.kind === "bird");
    expect(birds.length).toBeGreaterThanOrEqual(2);
    expect(birds.length).toBeLessThanOrEqual(3);
    expect(agents.some((a) => a.kind === "cat")).toBe(true);
  });

  test("고양이·새·사람이 시작하는 자리는 길·주차장·건물 위가 아니다", () => {
    // Cats and birds stay on grass all the way; a person starts on grass and walks on to their car.
    for (const a of agents.filter((x) => x.kind === "cat" || x.kind === "bird"))
      for (const p of a.path) expect(standable(site.plan, p)).toBe(true);
    for (const a of agents.filter((x) => x.kind === "person"))
      expect(standable(site.plan, a.path[0] as never)).toBe(true);
  });
});

describe("나무는 품질이 낮을수록 줄어든다 [REQ-105]", () => {
  test("높음은 전부, 가볍게는 6할 안팎, 최소는 3할 안팎이고 울타리 줄이 먼저 남는다", () => {
    const all = site.plan.trees;
    const high = treesAt(all, "high").length;
    const low = treesAt(all, "low").length;
    const min = treesAt(all, "min").length;
    expect(high).toBe(all.length);
    expect(low).toBeLessThan(high);
    expect(min).toBeLessThan(low);
    expect(low / high).toBeGreaterThan(TREE_SHARE.low - 0.1);
    expect(min / high).toBeLessThan(TREE_SHARE.min + 0.2);
    const groveKept = treesAt(all, "min").filter((t) => t.row === "grove").length;
    const groveAll = all.filter((t) => t.row === "grove").length;
    expect(groveKept / Math.max(1, groveAll)).toBeLessThan(min / high);
  });
});

describe("눌린 동물은 제 길로 돌아간다 [REQ-105]", () => {
  const cat = agents.find((a) => a.kind === "cat") as Agent;
  const bird = agents.find((a) => a.kind === "bird") as Agent;

  test("고양이는 몇 미터 걸어 앉았다가 있던 자리로 돌아와 하루를 잇는다", () => {
    const r = new Reactions(site.plan);
    const t0 = 50;
    const before = poseAt(cat, t0);
    expect(r.start(cat, t0, false)).toBe(true);
    let far = 0;
    for (let t = t0; t < t0 + totalOf("cat", false); t += 0.1) {
      const p = r.placed(cat, t);
      far = Math.max(far, Math.hypot(p.x - before.x, p.z - before.z));
      expect(p.answering).toBe(true);
    }
    expect(far).toBeLessThanOrEqual(CAT_WALK_M + 0.01);
    expect(far).toBeGreaterThan(0.5);
    const end = r.placed(cat, t0 + totalOf("cat", false) + 0.01);
    expect(end.answering).toBe(false);
    expect(Math.hypot(end.x - before.x, end.z - before.z)).toBeLessThan(0.5);
    expect(r.busy).toBe(false);
  });

  test("새는 올라갔다 가까이 내려앉아 거기서 하루를 잇는다", () => {
    const r = new Reactions(site.plan);
    r.start(bird, 10, false);
    let top = 0;
    for (let t = 10; t < 10 + totalOf("bird", false); t += 0.1)
      top = Math.max(top, r.placed(bird, t).y);
    expect(top).toBeGreaterThan(2.8);
    const home = poseAt(bird, 10);
    const end = r.placed(bird, 10 + totalOf("bird", false) + 0.1);
    expect(end.y).toBe(0);
    const d = Math.hypot(end.x - home.x, end.z - home.z);
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(2.5);
  });

  test("움직임 줄이기에서는 아무것도 시작하지 않고 한 번 더 눌러도 괜찮다", () => {
    const r = new Reactions(site.plan);
    expect(r.start(cat, 5, true)).toBe(true);
    expect(r.busy).toBe(false);
    expect(r.placed(cat, 6).answering).toBe(false);
  });

  test("고양이와 새가 아닌 것은 반응하지 않는다", () => {
    const r = new Reactions(site.plan);
    const person = agents.find((a) => a.kind === "person") as Agent;
    expect(r.start(person, 0, false)).toBe(false);
  });
});
