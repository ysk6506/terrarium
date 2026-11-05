import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, bulkProps, type Entity, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { buildingScene } from "./building";
import { hallMode, modeOfForms, type RackForm } from "./modes";
import { LAYERS, rackColor, rackColors } from "./overlay";
import { heatColor, hex } from "./palette";
import { boundsOfBox, overlapBounds } from "./plan";
import { rackScene, rowOf } from "./rack";
import { roomScene } from "./room";
import { coolingRoutes, networkRoutes, powerRoutes } from "./routes";

const catalog = new Catalog();
const bp = generateCampus(
  {
    ...DEFAULT_CAMPUS,
    site: "giheung",
    seed: 11,
    buildings: 2,
    floors: 2,
    hallsPerFloor: 2,
    podsPerHall: 8,
    detail: 0.4,
  },
  catalog,
).blueprint;
const index = new BlueprintIndex(bp);
const halls = index.ofKind("room").filter((r) => roomPurposeOf(r) === "data_hall");

describe("a room seen from inside [REQ-006] [REQ-047]", () => {
  test("a data hall lists its racks by kind, its pods, its machines and its overhead runs", () => {
    for (const hall of halls) {
      const room = roomScene(index, catalog, hall.id);
      expect(room).toBeDefined();
      if (!room) continue;
      const counted = room.sets.reduce((n, s) => n + s.ids.length, 0);
      expect(counted).toBe(room.racks);
      expect(room.racks).toBeGreaterThan(0);
      expect(room.floorY).toBeGreaterThan(0.5);
      expect(room.rows.length).toBeGreaterThan(0);
      expect(room.equipment.length).toBeGreaterThan(0);
      for (const set of room.sets) {
        expect(set.at).toHaveLength(set.ids.length * 4);
        for (let i = 0; i < set.ids.length; i++) {
          const x = set.at[i * 4] as number;
          const z = set.at[i * 4 + 2] as number;
          expect(x).toBeGreaterThan(0);
          expect(x).toBeLessThanOrEqual(room.w + 0.01);
          expect(z).toBeGreaterThan(0);
          expect(z).toBeLessThanOrEqual(room.d + 0.01);
        }
      }
    }
  });

  test("halls differ: some are closed in aisle by aisle, some have no containment at all", () => {
    const withPods = halls.filter((h) => (roomScene(index, catalog, h.id)?.pods.length ?? 0) > 0);
    const without = halls.filter((h) => roomScene(index, catalog, h.id)?.pods.length === 0);
    expect(withPods.length).toBeGreaterThan(0);
    for (const h of withPods) {
      const room = roomScene(index, catalog, h.id);
      for (const pod of room?.pods ?? []) {
        expect(pod.enclosure.x1).toBeGreaterThan(pod.enclosure.x0);
        expect(pod.enclosure.z1).toBeGreaterThan(pod.enclosure.z0);
        expect(["cold", "hot"]).toContain(pod.aisle);
      }
    }
    for (const h of without) expect(roomScene(index, catalog, h.id)?.racks).toBeGreaterThan(0);
  });

  test("a liquid hall carries coolant pipes and the equipment that makes them", () => {
    const liquid = halls.find((h) =>
      ["dlc", "hybrid", "immersion"].includes(String(h.props.cooling)),
    );
    if (!liquid) throw new Error("no liquid hall in the sample");
    const room = roomScene(index, catalog, liquid.id);
    expect(room?.pipes.length).toBeGreaterThan(0);
    expect(room?.pipes.some((p) => p.kind === "supply")).toBe(true);
    expect(room?.pipes.some((p) => p.kind === "return")).toBe(true);
    expect(
      room?.sets.some(
        (s) => s.kind.form === "dlc" || s.kind.form === "tank" || s.kind.form === "rdhx",
      ),
    ).toBe(true);
  });

  test("columns keep clear of racks and machines", () => {
    const room = roomScene(index, catalog, (halls[0] as Entity).id);
    if (!room) throw new Error("no room");
    const machines = room.equipment.map(boundsOfBox);
    for (const c of room.columns) {
      const col = { x0: c.x - 0.4, z0: c.z - 0.4, x1: c.x + 0.4, z1: c.z + 0.4 };
      for (const m of machines) expect(overlapBounds(col, m)).toBe(false);
    }
  });

  test("a room that is not a data hall has no rows of racks, and unknown ids give nothing", () => {
    const plant = index.ofKind("room").find((r) => roomPurposeOf(r) === "electrical");
    if (!plant) throw new Error("no electrical room");
    const room = roomScene(index, catalog, plant.id);
    expect(room?.rows).toEqual([]);
    expect(room?.mode).toBeUndefined();
    expect(room?.equipment.length).toBeGreaterThan(0);
    expect(roomScene(index, catalog, "nope")).toBeUndefined();
    expect(roomScene(index, catalog, (index.ofKind("site")[0] as Entity).id)).toBeUndefined();
  });
});

describe("a building cut open [REQ-006] [REQ-043]", () => {
  test("floors stack up and each room sits where the blueprint puts it", () => {
    const b = index.ofKind("building")[0] as Entity;
    const scene = buildingScene(index, catalog, b.id);
    expect(scene?.floors).toHaveLength(3);
    let y = 0;
    for (const f of scene?.floors ?? []) {
      expect(f.y).toBeCloseTo(y);
      y += f.height;
      expect(f.rooms.length).toBeGreaterThan(0);
      for (const r of f.rooms) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.scene.w).toBeLessThanOrEqual((scene?.w ?? 0) + 0.01);
      }
    }
    expect(scene?.height).toBeCloseTo(y);
    expect(buildingScene(index, catalog, "nope")).toBeUndefined();
  });
});

describe("a rack close up [REQ-006] [REQ-045] [REQ-049]", () => {
  test("a detailed rack lists its machines unit by unit with their makers' looks", () => {
    const rack = index
      .ofKind("rack")
      .find((r) => r.props.bulk !== true && index.childrenOf(r.id, "server").length > 3);
    if (!rack) throw new Error("no detailed rack");
    const scene = rackScene(index, catalog, rack.id);
    expect(scene?.bulk).toBe(false);
    expect(scene?.devices.filter((d) => d.kind === "server").length).toBeGreaterThan(3);
    const us = (scene?.devices ?? []).filter((d) => d.units > 0).map((d) => d.u);
    expect([...us].sort((a, b) => a - b)).toEqual(us);
    for (const d of scene?.devices ?? []) {
      expect(d.look.body).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.vendor.length).toBeGreaterThan(0);
      expect(d.synthetic).toBe(false);
    }
  });

  test("a light rack is drawn with as many machines as it counts", () => {
    const rack = index.ofKind("rack").find((r) => r.props.bulk === true);
    if (!rack) throw new Error("no light rack");
    const scene = rackScene(index, catalog, rack.id);
    expect(scene?.bulk).toBe(true);
    expect(scene?.devices).toHaveLength(Number(rack.props.bulkServers));
    expect(scene?.devices.every((d) => d.synthetic && d.id.startsWith(`${rack.id}#`))).toBe(true);
  });

  test("a light rack with a model the catalog does not know draws nothing; a missing rack gives nothing", () => {
    const broken: Entity = {
      id: "r-x",
      kind: "rack",
      name: "x",
      parentId: "nowhere",
      placement: { type: "spot", x: 1, y: 1, rotation: 0 },
      props: bulkProps({ servers: 4, modelId: "no-such-model", util: 0.3, overheadW: 100 }),
    };
    const lone = new BlueprintIndex({ ...bp, entities: [...bp.entities, broken] });
    expect(rackScene(lone, catalog, "r-x")?.devices).toEqual([]);
    expect(rackScene(lone, catalog, "nope")).toBeUndefined();
  });

  test("the neighbours in a row are found in order, a few each side", () => {
    const pod = index.ofKind("containment")[0] as Entity;
    const racks = index.childrenOf(pod.id, "rack");
    const mid = racks[Math.floor(racks.length / 2)] as Entity;
    const row = rowOf(index, mid.id, 1);
    expect(row).toContain(mid.id);
    expect(row.length).toBeLessThanOrEqual(3);
    expect(rowOf(index, "nope")).toEqual(["nope"]);
  });
});

describe("what a layer shows [REQ-006] [REQ-044] [REQ-046]", () => {
  const hall = halls.find((h) => String(h.props.cooling) === "air") ?? (halls[0] as Entity);
  const room = roomScene(index, catalog, hall.id);

  test("the cooling layer links racks to the units that cool them", () => {
    if (!room) throw new Error("no room");
    const r = coolingRoutes(index, room);
    expect(r.lines.length).toBeGreaterThan(0);
    for (const l of r.lines) expect(l.a[1]).toBeGreaterThan(0);
  });

  test("the power layer links racks to their feeding equipment, and the network layer to peers", () => {
    if (!room) throw new Error("no room");
    const p = powerRoutes(index, room);
    expect(p.lines.length + p.leaving).toBeGreaterThan(0);
    const n = networkRoutes(index, room);
    expect(n.lines.length + n.leaving).toBeGreaterThan(0);
  });

  test("a rack's colour follows its layer: heat scale, power load, alarms and dark when unpowered", () => {
    const paint = hex("#4a5060");
    const heat = new Map([
      ["a", 20],
      ["b", 34],
    ]);
    expect(rackColor("plain", {}, "a", paint, 0.5)).toEqual(paint);
    expect(rackColor("heat", { heat }, "a", paint, 0.5)).toEqual(heatColor(20));
    expect(rackColor("heat", { heat }, "b", paint, 0.5)).toEqual(heatColor(34));
    expect(rackColor("heat", {}, "z", paint, 0.5)).not.toEqual(paint);
    expect(rackColor("plain", { alarmed: new Set(["a"]) }, "a", paint, 0)[0]).toBeGreaterThan(0.7);
    expect(rackColor("plain", { unpowered: new Set(["a"]) }, "a", paint, 0)[0]).toBeLessThan(0.5);
    expect(rackColor("plain", { warned: new Set(["a"]) }, "a", paint, 0)).not.toEqual(paint);
    const idle = rackColor("power", { loadShare: new Map([["a", 0]]) }, "a", paint, 0);
    const busy = rackColor("power", { loadShare: new Map([["a", 1]]) }, "a", paint, 0);
    expect(busy).not.toEqual(idle);
    for (const layer of ["cooling", "network", "agents"] as const)
      expect(rackColor(layer, {}, "a", paint, 0.5)).toHaveLength(3);
    expect(LAYERS.map((l) => l.id)).toEqual([
      "plain",
      "power",
      "cooling",
      "network",
      "heat",
      "agents",
    ]);
  });

  test("a whole group of racks gets one colour per rack", () => {
    if (!room) throw new Error("no room");
    const set = room.sets[0];
    if (!set) throw new Error("no set");
    expect(rackColors("plain", {}, set)).toHaveLength(set.ids.length * 3);
  });

  test("the temperature scale runs from cool to hot", () => {
    expect(heatColor(10)).toEqual(heatColor(18));
    expect(heatColor(50)).toEqual(heatColor(32));
    const mid = heatColor(26);
    expect(mid[0]).toBeGreaterThan(heatColor(18)[0]);
  });
});

describe("how a hall is cooled [REQ-044]", () => {
  test("racks add up to a mode when the hall does not say", () => {
    const forms = (...f: RackForm[]) => new Set<RackForm>(f);
    expect(modeOfForms(forms("air"))).toBe("air");
    expect(modeOfForms(forms("tank"))).toBe("immersion");
    expect(modeOfForms(forms("dlc"))).toBe("dlc");
    expect(modeOfForms(forms("rdhx"))).toBe("hybrid");
    expect(modeOfForms(forms("air", "dlc"))).toBe("hybrid");
    expect(modeOfForms(forms("dlc", "tank"))).toBe("hybrid");
    // A hall that does not say how it is cooled is read from its racks: plain racks only means air.
    for (const h of halls) {
      const blank = { ...h, props: { ...h.props, cooling: "?" } };
      const derived = hallMode(index, catalog, blank);
      expect(derived).toBeDefined();
      if (h.props.cooling === "air") expect(derived).toBe("air");
    }
    const empty = index.ofKind("room").find((r) => roomPurposeOf(r) === "noc") as Entity;
    expect(hallMode(index, catalog, { ...empty, props: {} })).toBeUndefined();
  });
});
