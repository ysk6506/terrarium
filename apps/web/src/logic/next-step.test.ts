import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { builder } from ".";
import { hasRacks, nextStep, TOUR_STEPS, tourLabel } from "./next-step";
import {
  advanceTour,
  answerTour,
  hasLearned,
  LEARNED_KEY,
  learn,
  queueTour,
  readTour,
  TOUR_KEY,
  tourMode,
} from "./tour";

const catalog = new Catalog();
const land = builder.newSite({
  name: "땅",
  siteName: "땅",
  outline: builder.rectangleOutline(300, 200),
  forSale: false,
  market: "general",
});
const small = builder.smallStart({ name: "내 사업장", siteName: "내 사업장" }, catalog);
const idx = (bp: Blueprint) => new BlueprintIndex(bp);

function memory(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("the 다음 할 일 chip is a function of the world [REQ-077]", () => {
  test("it walks one road: no land, no building, no server room, an empty one, not run, done", () => {
    const nothing: Blueprint = { ...land, entities: [], links: [] };
    expect(nextStep(idx(nothing), false).id).toBe("land");
    expect(nextStep(idx(land), false).id).toBe("building");
    const built = builder.addBuilding(
      land,
      catalog,
      { x: 100, y: 80, w: 30, d: 20 },
      "data_center",
    );
    expect(nextStep(idx(built.blueprint), false).id).toBe("room");
    expect(nextStep(idx(small), false)).toMatchObject({ id: "fill", label: "다음: 서버룸 채우기" });
    const room = idx(small).ofKind("room")[0];
    const filled = builder.fillRoom(small, catalog, room?.id ?? "", {
      load: "half",
      aisle: "cold",
    });
    expect(nextStep(idx(filled.blueprint), false)).toMatchObject({
      id: "run",
      label: "다음: 시운전",
    });
    expect(nextStep(idx(filled.blueprint), true).id).toBe("done");
  });

  test("every label starts with 다음, names one thing, and a step knows where it is", () => {
    const labels = [
      nextStep(idx({ ...land, entities: [], links: [] }), false),
      nextStep(idx(land), false),
      nextStep(idx(small), false),
    ];
    for (const step of labels) expect(step.label).toMatch(/^다음: [^·.]+$/);
    const fill = nextStep(idx(small), false);
    const room = idx(small).ofKind("room")[0];
    expect(fill.aim).toMatchObject({
      kind: "go",
      level: { kind: "room", id: room?.id },
      select: [room?.id],
    });
    const building = nextStep(idx(land), false);
    expect(building.aim).toMatchObject({ kind: "go", tool: { kind: "building" } });
  });

  test("a room with racks is not bare, and a bare one is found on its own floor", () => {
    const room = idx(small).ofKind("room")[0];
    expect(hasRacks(idx(small), room?.id ?? "")).toBe(false);
    const filled = builder.fillRoom(small, catalog, room?.id ?? "", {
      load: "half",
      aisle: "cold",
    });
    expect(hasRacks(idx(filled.blueprint), room?.id ?? "")).toBe(true);
    expect(builder.openingLevel(idx(small))).toEqual({ kind: "site" });
    expect(builder.openingLevel(idx(filled.blueprint))).toEqual({ kind: "room", id: room?.id });
  });
});

describe("둘러보기 is the same chip pointing at five places [REQ-077]", () => {
  test("five steps, each with a label and an aim that exists in a small site", () => {
    expect(TOUR_STEPS).toHaveLength(5);
    expect(tourLabel(1)).toBe("둘러보기 2/5 · 건물 안으로 들어가기");
    for (const step of TOUR_STEPS) expect(step.aim(idx(small)).kind).toMatch(/go|run/);
  });

  test("it is asked once in the first small site, a yes runs it step by step, a no is final", () => {
    const store = memory();
    expect(tourMode(readTour(store), "w-1")).toBe("none");
    expect(tourMode(queueTour(store, "w-1"), "w-1")).toBe("ask");
    expect(tourMode(queueTour(store, "w-2"), "w-2")).toBe("ask");
    const yes = answerTour(store, "w-2", true);
    expect(tourMode(yes, "w-2")).toBe("run");
    expect(tourMode(yes, "w-1")).toBe("none");
    let save = yes;
    for (let i = 0; i < 4; i++) save = advanceTour(store, save);
    expect(tourMode(save, "w-2")).toBe("run");
    save = advanceTour(store, save);
    expect(save).toEqual({ done: true });
    expect(queueTour(store, "w-3")).toEqual({ done: true });
    expect(JSON.parse(store.getItem(TOUR_KEY) ?? "{}")).toEqual({ done: true });
  });

  test("a store that refuses, or holds rubbish, never breaks it; a lesson is learned once", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readTour(broken)).toEqual({});
    expect(queueTour(broken, "w-1")).toEqual({ pending: "w-1" });
    const rubbish = { getItem: () => "[1,2", setItem: () => undefined };
    expect(readTour(rubbish)).toEqual({});
    const store = memory();
    expect(hasLearned(store, "drag")).toBe(false);
    learn(store, "drag");
    expect(hasLearned(store, "drag")).toBe(true);
    expect(JSON.parse(store.getItem(LEARNED_KEY) ?? "{}")).toEqual({ drag: true });
    expect(() => learn(broken, "drag")).not.toThrow();
  });
});
