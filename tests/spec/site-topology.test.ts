import { fold, impactOf, layerShape } from "@terrarium/core/topology";
import { describe, expect, test } from "vitest";
import { siteLab } from "./site-lab";

describe("the site stage opens the network layer [REQ-106] [REQ-078]", () => {
  test("two sites and the line between them stand in the first column, ahead of the services", () => {
    const { world } = siteLab("warm");
    const shape = layerShape(world.index, "network");
    expect(shape.stages[0]?.label).toBe("사이트");
    const first = shape.members[0] ?? [];
    expect(first.filter((id) => shape.kindOf.get(id) === "dr_site")).toHaveLength(2);
    expect(first.filter((id) => shape.kindOf.get(id) === "site_link")).toHaveLength(1);
    expect(shape.stages[1]?.label).toBe("서비스");
  });

  test("a service leans on the site its nodes stand in, and a warm copy leans on the other one too", () => {
    const { world } = siteLab("warm");
    const shape = layerShape(world.index, "network");
    const sites = world.index.ofKind("dr_site").map((s) => s.id);
    const supplying = (shape.suppliers.get("svc-iap") ?? []).filter((id) => sites.includes(id));
    expect(supplying).toEqual(expect.arrayContaining(sites));
  });

  test("a world with one site has no site column", () => {
    const { world } = siteLab("raft");
    const shape = layerShape(world.index, "network");
    expect(shape.stages[0]?.label).not.toBe("사이트");
  });

  test("the board folds the site column into two tiles and a pipe from each to the services", () => {
    const { world } = siteLab("hot");
    const board = fold(world, { layer: "network" });
    const tiles = board.tiles.filter((t) => t.stage === 0);
    expect(tiles.some((t) => t.kind === "dr_site")).toBe(true);
    expect(board.edges.some((e) => tiles.some((t) => t.id === e.from))).toBe(true);
  });

  test("when the primary site is lost the impact walks from it to the services that stand there", () => {
    const { world, physics, inject } = siteLab("warm");
    const primary = world.index.ofKind("dr_site").find((s) => s.props.role === "primary");
    expect(primary).toBeDefined();
    const id = primary?.id as string;
    const quiet = impactOf(world);
    expect(quiet.affected.has("svc-iap")).toBe(false);
    inject("site_power_loss", id);
    physics.run(20);
    const impact = impactOf(world);
    expect(world.stateAs(id, "dr_site").status).toBe("down");
    const tile = fold(world, { layer: "network" }).tiles.find((t) => t.id === id);
    expect(tile?.state).not.toBe("ok");
    expect(impact.services.down + impact.services.degraded).toBeGreaterThan(0);
    const touched = [impact.affected, impact.causes.alarmed, impact.causes.faulted];
    expect(touched.some((set) => set.has("svc-iap"))).toBe(true);
  });

  test("a cut line shows on the line tile and the sites stay up", () => {
    const { world, physics, inject } = siteLab("warm");
    inject("wan_link_down", "wan-ab");
    physics.run(20);
    const board = fold(world, { layer: "network" });
    const link = board.tiles.find((t) => t.kind === "site_link");
    expect(link?.state).not.toBe("ok");
    expect(link?.line).toContain("끊겼");
  });
});
