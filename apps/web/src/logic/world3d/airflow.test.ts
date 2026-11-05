/**
 * The airflow map (REQ-072, ADR-0074): the floor's temperature, the colour of the doors and the paths
 * the air takes are worked out from the readings alone. A stopped unit gives nothing, strength falls
 * with the distance from a running one, and a whole hall stays within the budget of puffs and arrows.
 */
import { Catalog } from "@terrarium/core/catalog";
import { INLET_WARNING_C, RACK_CRITICAL_C } from "@terrarium/core/physics";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { preview } from "../builder/preview";
import {
  AIR_NOTE,
  AIR_VIEWS,
  AIR_WORDS,
  type AirReadings,
  type AirView,
  ARROWS_PER_PATH,
  airflowOf,
  CRITICAL_C,
  doorColor,
  fieldAt,
  hottestText,
  PUFF_BUDGET,
  WARN_C,
} from "./airflow";
import { heatColor } from "./palette";
import { type Pod, type RoomScene, roomScene } from "./room";

/** A hall by hand: two rows of ten racks facing each other, a unit at each end of the back wall. */
function hall(opts: { pods?: boolean; mode?: RoomScene["mode"] } = {}): RoomScene {
  const ids: string[] = [];
  const at: number[] = [];
  for (const [row, z, turn] of [
    ["a", 6, 0],
    ["b", 9, Math.PI],
  ] as const)
    for (let i = 0; i < 10; i++) {
      ids.push(`${row}${i}`);
      at.push(4.5 + i * 0.7, 0.6, z, turn);
    }
  const kind = {
    key: "k",
    modelId: "k",
    form: "air" as const,
    name: "랙",
    w: 0.6,
    d: 1.2,
    h: 2,
    units: 42,
    unitM: 0.0445,
    look: { body: "#444", accent: "#888", finish: "metal" as const, front: "mesh" as const },
  };
  const unit = (id: string, x: number) => ({
    id,
    kind: "cooling_unit" as const,
    name: id,
    x,
    z: 2,
    w: 2.4,
    d: 0.9,
    rot: 0,
    modelId: "crah",
    style: "crah",
    look: kind.look,
    h: 2.4,
    oy: 0.6,
    capacity: 50,
    wet: false,
  });
  const pod: Pod = {
    id: "pod",
    kind: "containment",
    name: "pod",
    x: 8,
    z: 7.5,
    w: 7.3,
    d: 3,
    rot: 0,
    aisle: "cold",
    enclosure: { x0: 4.2, z0: 6.6, x1: 11.5, z1: 8.4 },
    rackIds: ids,
  };
  return {
    id: "hall",
    name: "홀",
    purpose: "data_hall",
    ...(opts.mode ? { mode: opts.mode } : {}),
    w: 20,
    d: 12,
    floorY: 0.6,
    sets: [
      {
        kind,
        ids,
        at: new Float32Array(at),
        bulk: new Uint8Array(ids.length),
        servers: new Uint16Array(ids.length),
        fill: new Float32Array(ids.length).fill(0.5),
      },
    ],
    pods: opts.pods === false ? [] : [pod],
    equipment: [unit("left", 2), unit("right", 18)],
    rows: [],
    pipes: [],
    columns: [],
    racks: ids.length,
    servers: 0,
  };
}

const unitAir = (running: boolean, loadKw = 30) => ({
  running,
  supplyC: 18,
  returnC: 30,
  loadKw: running ? loadKw : 0,
  capacityKw: 50,
});

function readings(
  scene: RoomScene,
  left: boolean,
  right: boolean,
  rightKw = 30,
  leftKw = 30,
): AirReadings {
  const racks = new Map<string, { inletC: number; outletC: number }>();
  for (const set of scene.sets)
    for (const id of set.ids) racks.set(id, { inletC: 24, outletC: 38 });
  return {
    racks,
    units: new Map([
      ["left", unitAir(left, leftKw)],
      ["right", unitAir(right, rightKw)],
    ]),
    ambientC: 25,
  };
}

describe("the floor is warm where no unit reaches and cold near a running one [REQ-072]", () => {
  const scene = hall();
  test("with the left unit stopped the left side is warmer than the right, and warmer than it was running", () => {
    const stopped = airflowOf(scene, readings(scene, false, true), "inlet").field;
    const both = airflowOf(scene, readings(scene, true, true), "inlet").field;
    expect(fieldAt(stopped, 2, 4)).toBeGreaterThan(fieldAt(stopped, 18, 4) + 1);
    expect(fieldAt(stopped, 2, 4)).toBeGreaterThan(fieldAt(both, 2, 4) + 1);
    expect(Math.abs(fieldAt(both, 2, 4) - fieldAt(both, 18, 4))).toBeLessThan(0.5);
  });

  test("the cold aisle is cold where the supply reaches, and warm behind the racks", () => {
    const f = airflowOf(scene, readings(scene, true, true), "inlet").field;
    expect(fieldAt(f, 8, 7.5)).toBeLessThan(fieldAt(f, 8, 10.4));
  });

  test("the outlet view reads warmer than the inlet view over the same room", () => {
    const r = readings(scene, true, true);
    const inlet = airflowOf(scene, r, "inlet").field;
    const outlet = airflowOf(scene, r, "outlet").field;
    expect(fieldAt(outlet, 8, 10.4)).toBeGreaterThan(fieldAt(inlet, 8, 10.4));
  });

  test("every cell is a real temperature, for every view", () => {
    for (const { id } of AIR_VIEWS) {
      const f = airflowOf(scene, readings(scene, false, false), id as AirView).field;
      expect(f.values.length).toBe(f.cols * f.rows);
      for (const v of f.values) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("the paths of the air and how strong each is [REQ-072]", () => {
  const scene = hall();
  const rises = (r: AirReadings) =>
    airflowOf(scene, r, "flow").paths.filter((p) => p.kind === "rise");

  test("strength falls with the distance from the running unit", () => {
    const set = scene.sets[0];
    const where = new Map(
      set?.ids.map((id, i) => [id, [set.at[i * 4] as number, set.at[i * 4 + 2] as number]]),
    );
    const list = rises(readings(scene, false, true))
      .map((p) => {
        const [x, z] = where.get(p.id.replace("rise-", "")) as number[];
        return { gap: Math.hypot((x as number) - 18, (z as number) - 2), s: p.strength };
      })
      .sort((a, b) => a.gap - b.gap);
    expect(list.length).toBeGreaterThan(10);
    for (let i = 1; i < list.length; i++)
      expect((list[i] as { s: number }).s).toBeLessThanOrEqual(
        (list[i - 1] as { s: number }).s + 1e-9,
      );
    expect((list[0] as { s: number }).s).toBeGreaterThan((list.at(-1) as { s: number }).s);
  });

  test("a unit that takes more of the load blows harder", () => {
    const strength = (leftKw: number) => {
      const p = airflowOf(scene, readings(scene, true, true, 30, leftKw), "flow").paths.find(
        (x) => x.kind === "supply" && x.unit === "left",
      );
      return p?.strength ?? 0;
    };
    expect(strength(40)).toBeGreaterThan(strength(5));
  });

  test("a stopped unit has no supply, no rise and no return, and nothing points at it", () => {
    const only = airflowOf(scene, readings(scene, false, true), "flow").paths;
    expect(only.some((p) => p.unit === "left")).toBe(false);
    expect(only.some((p) => p.kind === "supply" && p.unit === "right")).toBe(true);
    const none = airflowOf(scene, readings(scene, false, false), "flow").paths;
    expect(none.filter((p) => p.kind !== "exhaust")).toHaveLength(0);
    expect(none.filter((p) => p.kind === "exhaust").length).toBeGreaterThan(0);
  });

  test("the supply leaves the unit along the floor into the cold aisle and the return runs back up to it", () => {
    const paths = airflowOf(scene, readings(scene, false, true), "flow").paths;
    const supply = paths.find((p) => p.kind === "supply");
    const back = paths.find((p) => p.kind === "return");
    expect(supply?.points[0]?.[0]).toBeGreaterThan(15);
    expect(supply?.points.at(-1)?.[0]).toBeLessThan(supply?.points[0]?.[0] ?? 0);
    expect(supply?.points.at(-2)?.[1]).toBeCloseTo(0.72, 1);
    expect(back?.points.at(-1)?.[0]).toBeGreaterThan(15);
    expect(back?.points[0]?.[1]).toBeGreaterThan(2.5);
  });

  test("a room without containment treats the space in front of a unit as the cold side", () => {
    const open = hall({ pods: false });
    const paths = airflowOf(open, readings(open, false, true), "flow").paths;
    const supply = paths.filter((p) => p.kind === "supply");
    expect(supply).toHaveLength(1);
    expect(supply[0]?.points.at(-1)?.[2] ?? 0).toBeGreaterThan(2.5);
    expect(paths.some((p) => p.kind === "rise" && p.unit === "right")).toBe(true);
  });

  test("a liquid-cooled room gets the field and no flow", () => {
    for (const mode of ["immersion", "dlc"] as const) {
      const liquid = hall({ mode });
      const air = airflowOf(liquid, readings(liquid, true, true), "flow");
      expect(air.liquid).toBe(true);
      expect(air.paths).toHaveLength(0);
      expect(air.field.values.length).toBeGreaterThan(0);
    }
  });
});

describe("a whole hall stays within the budget [REQ-072]", () => {
  const catalog = new Catalog();
  const bp = generateCampus(
    {
      ...DEFAULT_CAMPUS,
      site: "giheung",
      seed: 5,
      buildings: 1,
      floors: 1,
      hallsPerFloor: 2,
      podsPerHall: 40,
      detail: 0.05,
    },
    catalog,
  ).blueprint;
  const index = new BlueprintIndex(bp);
  const halls = index.ofKind("room").filter((r) => roomPurposeOf(r) === "data_hall");
  const flat = (room: RoomScene): AirReadings => ({
    racks: new Map(
      room.sets.flatMap((s) =>
        s.ids.map((id, i) => [id, { inletC: 22 + (i % 7), outletC: 36 + (i % 5) }]),
      ),
    ),
    units: new Map(
      room.equipment
        .filter((e) => e.kind === "cooling_unit")
        .map((e, i) => [e.id, unitAir(i % 4 !== 0, 20 + (i % 3) * 10)]),
    ),
    ambientC: 25,
  });

  test("hundreds of racks: at most 600 puffs, at most 4 arrows on a path, drawn in a moment", () => {
    let biggest = 0;
    for (const hallEntity of halls) {
      const room = roomScene(index, catalog, hallEntity.id);
      if (!room) continue;
      biggest = Math.max(biggest, room.racks);
      const started = performance.now();
      const air = airflowOf(room, flat(room), "flow");
      const took = performance.now() - started;
      expect(air.puffs).toBeLessThanOrEqual(PUFF_BUDGET);
      for (const p of air.paths) {
        expect(p.arrows).toBeLessThanOrEqual(ARROWS_PER_PATH);
        expect(p.puffs).toBeGreaterThan(0);
        expect(p.strength).toBeGreaterThan(0);
        expect(p.strength).toBeLessThanOrEqual(1);
      }
      expect(took).toBeLessThan(1500);
    }
    expect(biggest).toBeGreaterThan(150);
  });
});

describe("colours, words and the real physics [REQ-072]", () => {
  test("a rack's door takes the palette's heat colour for its inlet; the flow view keeps it grey", () => {
    const rack = { inletC: 24, outletC: 40 } as Parameters<typeof doorColor>[1];
    expect(doorColor("inlet", rack)).toEqual(heatColor(24));
    const hot = doorColor("inlet", { ...rack, inletC: 31 });
    const cool = doorColor("inlet", { ...rack, inletC: 19 });
    expect(hot[0]).toBeGreaterThan(cool[0]);
    expect(hot[2]).toBeLessThan(cool[2]);
    expect(doorColor("flow", rack)).toEqual(doorColor("flow", { ...rack, inletC: 33 }));
    expect(doorColor("outlet", rack)).not.toEqual(doorColor("inlet", rack));
  });

  test("the warning and critical lines are the physics', and the callout says how far a rack is from them", () => {
    expect(WARN_C).toBe(INLET_WARNING_C);
    expect(CRITICAL_C).toBe(RACK_CRITICAL_C);
    expect(hottestText("A01", 33.1)).toBe(
      `가장 더운 곳 · A01 흡기 33.1°C · 심각선 ${CRITICAL_C}°C를 1.1°C 넘었어요`,
    );
    expect(hottestText("A01", 29)).toContain("심각선까지 3.0°C 남았어요");
    expect(hottestText("A01", 24)).toContain(`경고선 ${WARN_C}°C까지 3.0°C 남았어요`);
    expect(AIR_NOTE).toContain("유체 해석(CFD)이 아니에요");
    expect(AIR_WORDS.top).toBe("위에서 본 지도");
  });

  test("from a world run in the browser: a unit stopped for the run leaves no air path, and the frames follow the run", () => {
    const catalog = new Catalog();
    const bp = generateCampus(
      {
        ...DEFAULT_CAMPUS,
        site: "giheung",
        seed: 3,
        buildings: 1,
        floors: 1,
        hallsPerFloor: 1,
        podsPerHall: 4,
        detail: 1,
      },
      catalog,
    ).blueprint;
    const index = new BlueprintIndex(bp);
    const hallEntity = index.ofKind("room").find((r) => roomPurposeOf(r) === "data_hall");
    if (!hallEntity) throw new Error("no hall in the sample");
    const room = roomScene(index, catalog, hallEntity.id) as RoomScene;
    const unitIds = room.equipment.filter((e) => e.kind === "cooling_unit").map((e) => e.id);
    expect(unitIds.length).toBeGreaterThan(1);
    const stopped = unitIds[0] as string;
    const run = preview(bp, catalog, 300, new Set([stopped]));
    if ("problems" in run) throw new Error(run.problems.join());
    expect(run.frames.length).toBe(11);
    expect(run.frames[0]?.t).toBe(0);
    expect(run.frames.at(-1)?.t).toBe(300);
    expect(run.frames[0]?.units.get(stopped)?.running).toBe(true);
    expect(run.frames.at(-1)?.units.get(stopped)?.running).toBe(false);
    const last = run.frames.at(-1);
    if (!last) throw new Error("no frames");
    const air = airflowOf(
      room,
      { racks: last.racks, units: last.units, ambientC: last.rooms.get(room.id) ?? 22 },
      "flow",
    );
    expect(air.paths.some((p) => p.unit === stopped)).toBe(false);
    expect(air.paths.some((p) => p.kind === "supply")).toBe(true);
    expect(air.units.find((u) => u.id === stopped)?.running).toBe(false);
  });
});
