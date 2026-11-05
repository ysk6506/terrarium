import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { world3d } from "../../logic";
import type { Engine } from "./engine";
import { buildRackLayer } from "./rack-layer";

/** Materials that need no canvas: one plain material for each name. */
function fakeMaterials() {
  const cache = new Map<string, THREE.Material>();
  const basic = (key: string) => {
    const known = cache.get(key);
    if (known) return known;
    const made = new THREE.MeshBasicMaterial();
    cache.set(key, made);
    return made;
  };
  return {
    dark: basic("dark"),
    steel: basic("steel"),
    led: basic("led"),
    ledWarn: basic("ledWarn"),
    solid: (color: string) => basic(`solid:${color}`),
    paintOf: (look: { body: string }) => basic(`paint:${look.body}`),
    rulerPlate: (units: number) => basic(`ruler:${units}`),
  };
}

function fakeEngine(): Engine {
  return {
    mats: fakeMaterials(),
    strain: { level: 0 },
    invalidate: () => {},
    onFrame: () => () => {},
    animate: () => () => {},
  } as unknown as Engine;
}

const LOOK = { body: "#33373d", accent: "#4aa3ff", finish: "matte", front: "drive-bays" } as const;

/** A rack with every one of its 42 units taken: a switch on top, storage, GPU servers, 2U and 1U servers. */
function fullRack(): world3d.RackScene {
  const heights: number[] = [];
  let left = 42;
  const cycle = [2, 2, 4, 1, 2, 2, 2, 1, 4, 2];
  for (let i = 0; left > 0; i++) {
    const h = Math.min(left, cycle[i % cycle.length] as number);
    heights.push(h);
    left -= h;
  }
  let u = 1;
  const devices: world3d.Device[] = heights.map((units, i) => {
    const top = u + units - 1 === 42;
    const base = {
      id: `d${i}`,
      name: `d${i}`,
      modelId: "m",
      modelName: "m",
      vendor: "v",
      u,
      units,
      look: LOOK,
      synthetic: false,
    };
    u += units;
    if (top) return { ...base, kind: "switch", about: "48포트 25G" };
    if (units === 4) return { ...base, kind: "server", about: "GPU 8장 · 4U" };
    if (i % 5 === 0) return { ...base, kind: "storage", about: "100 TiB · 24디스크" };
    return { ...base, kind: "server", about: `CPU 2소켓 · ${units}U` };
  });
  return {
    id: "r",
    name: "r",
    kind: {
      key: "k",
      modelId: "m",
      form: "air",
      name: "rack",
      w: 0.6,
      d: 1.2,
      h: 2.1,
      units: 42,
      unitM: 0.0445,
      look: LOOK,
    },
    bulk: false,
    devices,
    used: 42,
  };
}

const stubWindow = (reduced: boolean) =>
  vi.stubGlobal("window", { matchMedia: () => ({ matches: reduced }) });

/** What a frame costs: every mesh drawn, and every mesh that casts a shadow is drawn again into the shadow map. */
function drawCalls(root: THREE.Object3D): number {
  let calls = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh.material as THREE.Material).visible === false) return;
    calls += mesh.castShadow ? 2 : 1;
  });
  return calls;
}

describe("a rack with every unit taken stays inside the draw budget [REQ-006] [REQ-036]", () => {
  beforeEach(() => stubWindow(true));
  afterEach(() => vi.unstubAllGlobals());

  test("42 units of devices, trays, ruler and blank panels take at most 60 draw calls", () => {
    const scene = fullRack();
    expect(scene.devices.reduce((n, d) => n + d.units, 0)).toBe(42);
    const layer = buildRackLayer(fakeEngine(), scene, {
      busy: new Set(scene.devices.map((d) => d.id)),
      condition: { warned: new Set(["d3"]), unpowered: new Set(["d4"]) },
    });
    const calls = drawCalls(layer.group);
    expect(calls).toBeGreaterThan(10);
    expect(calls).toBeLessThanOrEqual(world3d.RACK_DRAW_BUDGET);
    layer.dispose();
  });

  test("a device pulled out costs a few more calls, still inside the budget", () => {
    const scene = fullRack();
    const layer = buildRackLayer(fakeEngine(), scene, { busy: new Set(), condition: {} });
    const before = drawCalls(layer.group);
    layer.pick("d3");
    const after = drawCalls(layer.group);
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after).toBeLessThanOrEqual(world3d.RACK_DRAW_BUDGET);
    layer.dispose();
  });

  test("an empty rack is blank panels and a frame, not nothing", () => {
    const scene = { ...fullRack(), devices: [], used: 0 };
    const layer = buildRackLayer(fakeEngine(), scene, { busy: new Set(), condition: {} });
    expect(drawCalls(layer.group)).toBeGreaterThan(4);
    expect(layer.pickables).toHaveLength(0);
    layer.dispose();
  });
});

describe("a click on a server turns the rack about [REQ-006]", () => {
  beforeEach(() => stubWindow(true));
  afterEach(() => vi.unstubAllGlobals());

  const turnOf = (g: THREE.Group) => (g.children[0] as THREE.Group).rotation.y;

  test("the first click pulls the server out and shows the back; the next shows the front; Esc puts it back", () => {
    const states: Array<{ selected: string | undefined; rear: boolean }> = [];
    const scene = fullRack();
    const layer = buildRackLayer(fakeEngine(), scene, {
      busy: new Set(),
      condition: {},
      onChange: (s) => states.push(s),
    });
    expect(layer.state).toEqual({ selected: undefined, rear: false });
    layer.pick("d2");
    expect(layer.state).toEqual({ selected: "d2", rear: true });
    expect(turnOf(layer.group)).toBeCloseTo(Math.PI);
    layer.pick("d2");
    expect(layer.state).toEqual({ selected: "d2", rear: false });
    expect(turnOf(layer.group)).toBeCloseTo(0);
    layer.pick("d2");
    layer.pick("d5");
    expect(layer.state).toEqual({ selected: "d5", rear: true });
    layer.clear();
    expect(layer.state).toEqual({ selected: undefined, rear: false });
    expect(turnOf(layer.group)).toBeCloseTo(0);
    expect(states.length).toBeGreaterThanOrEqual(5);
    layer.dispose();
  });

  test("every server can be picked from the front and from the back: its box runs through the rack", () => {
    const scene = fullRack();
    const layer = buildRackLayer(fakeEngine(), scene, { busy: new Set(), condition: {} });
    expect(layer.pickables).toHaveLength(scene.devices.length);
    for (const p of layer.pickables) {
      const box = new THREE.Box3().setFromObject(p);
      expect(box.max.z - box.min.z).toBeGreaterThan(scene.kind.d * 0.8);
    }
    layer.dispose();
  });
});
