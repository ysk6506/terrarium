import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import type { Device } from "./rack";
import { rackScene } from "./rack";
import {
  BLINK_S,
  blinkPhase,
  busyDevices,
  classOf,
  frontOf,
  gapsOf,
  hasTor,
  phaseLit,
  powerLight,
  rearOf,
  rulerTicks,
} from "./rack-front";

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

const dev = (over: Partial<Device>): Device => ({
  id: "d",
  kind: "server",
  name: "d",
  modelId: "m",
  modelName: "m",
  vendor: "v",
  u: 1,
  units: 1,
  look: { body: "#333333", accent: "#4aa3ff", finish: "matte", front: "drive-bays" },
  synthetic: false,
  about: "CPU 2소켓 · 1U",
  ...over,
});

const kind = (units: number) =>
  ({
    key: "k",
    modelId: "m",
    form: "air",
    name: "rack",
    w: 0.6,
    d: 1.2,
    h: 2.1,
    units,
    unitM: 0.0445,
    look: { body: "#333333", accent: "#4aa3ff", finish: "matte", front: "mesh" },
  }) as const;

describe("what each kind of device shows on its front and back [REQ-006] [REQ-045]", () => {
  test("the kind and the height decide the face, not the maker", () => {
    expect(classOf(dev({}))).toBe("server");
    expect(classOf(dev({ units: 2 }))).toBe("server2u");
    expect(classOf(dev({ units: 4, about: "GPU 8장 · 4U" }))).toBe("gpu");
    expect(classOf(dev({ units: 2, about: "GPU 4장 · 2U" }))).toBe("gpu");
    expect(classOf(dev({ kind: "storage", units: 2 }))).toBe("storage");
    expect(classOf(dev({ kind: "switch" }))).toBe("switch");
  });

  test("a 1U server has one row of drive bays, a 2U two, a GPU server a grille, a switch ports", () => {
    expect(frontOf(dev({})).bays).toEqual({ cols: 8, rows: 1 });
    expect(frontOf(dev({ units: 2 })).bays).toEqual({ cols: 12, rows: 2 });
    const gpu = frontOf(dev({ units: 4, about: "GPU 8장 · 4U" }));
    expect(gpu.bays.cols).toBe(0);
    expect(gpu.grille).toBeGreaterThan(3);
    expect(frontOf(dev({ kind: "switch" })).ports).toBe(24);
    expect(frontOf(dev({ kind: "switch", units: 2 })).ports).toBe(48);
  });

  test("the kinds have different bezel colours, so a rack can be read at a glance", () => {
    const colours = [
      dev({}),
      dev({ units: 2 }),
      dev({ units: 4, about: "GPU 8장" }),
      dev({ kind: "storage", units: 2 }),
      dev({ kind: "switch" }),
    ].map((d) => frontOf(d).bezel);
    expect(new Set(colours).size).toBe(colours.length);
  });

  test("the back has power supplies, and a GPU server has more of them than a 1U server", () => {
    expect(rearOf(dev({})).psus).toBe(2);
    expect(rearOf(dev({ units: 4, about: "GPU 8장" })).psus).toBeGreaterThan(2);
    expect(rearOf(dev({ kind: "switch" })).fans).toBeGreaterThan(0);
  });
});

describe("the ruler and the empty units [REQ-006]", () => {
  test("42 units are numbered from 1, and every fifth one is bold", () => {
    const ticks = rulerTicks(42);
    expect(ticks).toHaveLength(42);
    expect(ticks[0]).toEqual({ u: 1, bold: true });
    expect(ticks.filter((t) => t.bold).map((t) => t.u)).toEqual([1, 5, 10, 15, 20, 25, 30, 35, 40]);
    expect(rulerTicks(0)).toEqual([]);
  });

  test("empty stretches are found between devices, and the one at the top is the top-of-rack slot", () => {
    const scene = { kind: kind(10), devices: [dev({ u: 2, units: 2 }), dev({ id: "e", u: 6 })] };
    expect(gapsOf(scene)).toEqual([
      { u: 1, units: 1, tor: false },
      { u: 4, units: 2, tor: false },
      { u: 7, units: 4, tor: true },
    ]);
    const full = { kind: kind(4), devices: [dev({ u: 1, units: 4 })] };
    expect(gapsOf(full)).toEqual([]);
  });

  test("a switch in the top two units is the rack's top-of-rack switch", () => {
    const top = { kind: kind(42), devices: [dev({ kind: "switch", u: 41 })] };
    const low = { kind: kind(42), devices: [dev({ kind: "switch", u: 20 })] };
    expect(hasTor(top)).toBe(true);
    expect(hasTor(low)).toBe(false);
  });

  test("a rack from the world has gaps that add up with its devices to its units", () => {
    const rack = index
      .ofKind("rack")
      .find((r) => r.props.bulk !== true && index.childrenOf(r.id, "server").length > 3);
    const scene = rackScene(index, catalog, rack?.id ?? "");
    if (!scene) throw new Error("no rack");
    const free = gapsOf(scene).reduce((n, g) => n + g.units, 0);
    expect(free + scene.used).toBeLessThanOrEqual(scene.kind.units);
    expect(scene.devices.length).toBeGreaterThan(3);
  });
});

describe("the lights [REQ-006] [REQ-036]", () => {
  test("the power light is green, amber when something is wrong, dark without power", () => {
    const cond = { warned: new Set(["w"]), alarmed: new Set(["a"]), unpowered: new Set(["u"]) };
    expect(powerLight("x", cond)).toBe("ok");
    expect(powerLight("w", cond)).toBe("warn");
    expect(powerLight("a", cond)).toBe("warn");
    expect(powerLight("u", cond)).toBe("off");
  });

  test("the network lights blink in two phases that are never lit together, and stand lit when the machine struggles", () => {
    for (let t = 0; t < 4; t += 0.1) expect(phaseLit(0, t, false)).not.toBe(phaseLit(1, t, false));
    expect(phaseLit(0, 0, false)).toBe(true);
    expect(phaseLit(0, BLINK_S, false)).toBe(false);
    expect(phaseLit(1, BLINK_S, true)).toBe(true);
    expect(phaseLit(0, BLINK_S, true)).toBe(true);
    expect([blinkPhase("a"), blinkPhase("b")].every((p) => p === 0 || p === 1)).toBe(true);
    expect(blinkPhase("srv-1")).toBe(blinkPhase("srv-1"));
  });

  test("only devices with something going on blink: busy servers, and the switch and storage when any server is", () => {
    const scene = {
      devices: [
        dev({ id: "idle-1" }),
        dev({ id: "load", u: 2 }),
        dev({ id: "sw", kind: "switch", u: 3 }),
        dev({ id: "st", kind: "storage", u: 4 }),
      ],
    };
    const lone = new BlueprintIndex({
      ...bp,
      entities: [
        ...bp.entities,
        { id: "load", kind: "server", name: "load", props: { cpuUtil: 0.6 } },
        { id: "idle-1", kind: "server", name: "idle", props: { cpuUtil: 0 } },
      ],
    });
    expect([...busyDevices(lone, scene)].sort()).toEqual(["load", "st", "sw"]);
    expect(busyDevices(lone, { devices: [dev({ id: "idle-1" })] }).size).toBe(0);
    const synthetic = busyDevices(index, { devices: [dev({ id: "r#1", synthetic: true })] });
    expect(synthetic.has("r#1")).toBe(true);
  });
});

describe("the data hall has racks to draw [REQ-006]", () => {
  test("the world has a data hall with detailed racks", () => {
    const halls = index.ofKind("room").filter((r) => roomPurposeOf(r) === "data_hall");
    expect(halls.length).toBeGreaterThan(0);
  });
});
