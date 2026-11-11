import { describe, expect, test } from "vitest";
import { hrefOf, type Page, parseLocation, SECTIONS, sectionOf, titleOf } from "./router";

describe("every page address round-trips, with every optional field [REQ-038]", () => {
  const pages: Page[] = [
    { name: "newWorld" },
    { name: "newWorld", template: "t-1", change: true, door: "service" },
    { name: "scenarioProcess", id: "s-1" },
    { name: "newExperiment", worldId: "w-1", quick: true },
    { name: "newExperiment", forkOf: "e-1", scenarioId: "s-1", worldId: "w-1", quick: true },
    { name: "connections" },
    { name: "settings" },
    { name: "operationGuide" },
    { name: "agentVersions", connectionId: "c-1", agentId: "a-1" },
  ];

  test("[REQ-038] an address and the screen it opens are one round trip", () => {
    for (const page of pages) {
      const href = hrefOf(page);
      const [path, search] = href.split("?");
      expect(parseLocation(path as string, search ? `?${search}` : ""), href).toEqual(page);
    }
  });

  test("[REQ-038] tab titles name the section, the world and the product", () => {
    expect(titleOf({ name: "home" })).toBe("테라리움");
    expect(titleOf({ name: "notFound", path: "/x" })).toBe("없는 화면 — 테라리움");
    expect(titleOf({ name: "newExperiment" })).toBe("새 실험 — 테라리움");
    const world = titleOf({ name: "world", id: "w" }, "내 세계");
    expect(world.startsWith("내 세계 — ")).toBe(true);
    expect(world.endsWith(" — 테라리움")).toBe(true);
    expect(sectionOf({ name: "settings" })).toBeDefined();
    expect(SECTIONS.length).toBeGreaterThan(0);
  });
});
