/**
 * The topology board on the whole of Hwaseong as it really is (REQ-078, ADR-0084): 15,000 racks, 23,000 servers and
 * 170,000 links. However it is asked, the board holds at most 150 tiles, loses no equipment, and is drawn in well
 * under the 3 seconds a person waits.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { DEFAULT_CAMPUS, generateCampus, SITE_CAMPUS_MIX } from "@terrarium/core/sources/worldgen";
import {
  chainOf,
  fold,
  impactCounts,
  impactOf,
  LAYER_IDS,
  type LayerId,
  layerShape,
  MAX_TILES,
} from "@terrarium/core/topology";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";

const catalog = new Catalog();
const campus = generateCampus(
  { ...DEFAULT_CAMPUS, ...SITE_CAMPUS_MIX.hwaseong, site: "hwaseong", seed: 1 },
  catalog,
);
const healthy = World.fromBlueprint(campus.blueprint, catalog);

/** The same world with a cooling unit stopped, a PDU tripped and a switch gone, after the physics has settled. */
function broken(): World {
  const world = World.fromBlueprint(campus.blueprint, catalog);
  const pick = (kind: Parameters<typeof world.index.ofKind>[0], prefix: string) =>
    world.index.ofKind(kind).find((e) => e.name.startsWith(prefix))?.id as string;
  const faults = [
    ["cooling_unit_failure", pick("cooling_unit", "CRAH-10F-A-")],
    ["breaker_trip", pick("pdu", "PDU-10A-P01-")],
    ["switch_failure", pick("switch", "tor-10a-p01-")],
  ] as const;
  for (const [type, target] of faults)
    world.apply({ type: "fault.add", fault: { id: `f-${target}`, type, target, params: {} } }, "t");
  new Physics(world).settle();
  return world;
}

/** Every `step`-th piece of equipment of the layer, with the first and last of each stage. */
function foci(world: World, layer: LayerId, count: number): string[] {
  const shape = layerShape(world.index, layer);
  const all = shape.members.flat();
  const step = Math.max(1, Math.floor(all.length / count));
  const picked = new Set(all.filter((_, i) => i % step === 0));
  for (const stage of shape.members) {
    picked.add(stage[0] as string);
    picked.add(stage.at(-1) as string);
  }
  return [...picked];
}

describe("the board of the whole of Hwaseong is small, complete and quick [REQ-078]", () => {
  test("the world is the real size: thousands of racks and a hundred thousand links", () => {
    expect(healthy.index.ofKind("rack").length).toBeGreaterThan(10_000);
    expect(healthy.index.allLinks().length).toBeGreaterThan(100_000);
  });

  test("a healthy world is a few tiles in every layer, and the first board comes within 3 seconds", () => {
    for (const layer of LAYER_IDS) {
      const started = Date.now();
      const board = fold(healthy, { layer });
      expect(Date.now() - started).toBeLessThan(3000);
      expect(board.tiles.length).toBeLessThanOrEqual(board.stages.length * 3);
      // the accelerator layer is empty in a campus without GPUs (REQ-107)
      if (layer !== "accel") expect(board.stats.folded).toBeGreaterThan(10_000);
    }
  });

  test("with a unit stopped, a PDU tripped and a switch gone, no pick and no opened container makes more than 150", () => {
    const world = broken();
    const worst: Record<string, number> = {};
    for (const layer of LAYER_IDS) {
      const impact = impactOf(world);
      for (const id of foci(world, layer, 12)) {
        const path = [...chainOf(world.index, id)];
        for (const opened of [[], path]) {
          const board = fold(world, { layer, path: opened, focus: { id, hops: 2 } }, impact);
          worst[layer] = Math.max(worst[layer] ?? 0, board.tiles.length);
          expect(board.tiles.length).toBeLessThanOrEqual(MAX_TILES);
        }
      }
    }
    expect(Object.keys(worst)).toHaveLength(3);
  }, 90_000);

  test("no board loses equipment: what each stage holds is what its tiles count", () => {
    const world = broken();
    for (const layer of LAYER_IDS) {
      const shape = layerShape(world.index, layer);
      const board = fold(world, { layer, path: ["site"] });
      board.stages.forEach((_, stage) => {
        const counted = board.tiles
          .filter((t) => t.stage === stage)
          .reduce((n, t) => n + t.count, 0);
        expect(counted).toBe(shape.members[stage]?.length);
      });
    }
  });

  test("the stopped unit is red, the racks that lean on it are grey, and the box counts them", () => {
    const world = broken();
    const unit = world.index
      .ofKind("cooling_unit")
      .find((e) => e.name.startsWith("CRAH-10F-A-")) as { id: string };
    const board = fold(world, { layer: "cooling" });
    expect(board.tiles.find((t) => t.id === unit.id)).toMatchObject({
      state: "fault",
      group: false,
    });
    expect(board.tiles.some((t) => t.group && t.state === "impact" && t.name.includes("랙"))).toBe(
      true,
    );
    const impact = impactOf(world);
    expect(impact.racks.size).toBeGreaterThan(0);
    expect(impactCounts(impact)).toMatch(/^서버룸 \d+ · 랙 \d+ · 서버 [\d,]+$/);
  });
});
