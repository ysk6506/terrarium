import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, type Entity, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  aisleLine,
  aislePose,
  EYE_M,
  insideLabel,
  LEAVE_HINT,
  runsAlongX,
  WALK_IN_S,
} from "./aisle";
import { aisleBox, crumbsOf, positionOf } from "./camera";
import { crewOf } from "./crew";
import { Grid, podBlocks, rackBlocks } from "./crew-route";
import { roomScene } from "./room";

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
const hall = index
  .ofKind("room")
  .find(
    (r) => roomPurposeOf(r) === "data_hall" && index.childrenOf(r.id, "containment").length > 0,
  ) as Entity;
const scene = roomScene(index, catalog, hall.id);
if (!scene) throw new Error("no hall scene");
const pod = scene.pods[0] as (typeof scene.pods)[number];

describe("looking into a containment [REQ-006] [REQ-074]", () => {
  test("the camera stands inside the aisle at eye height and looks along it", () => {
    const box = aisleBox(index, catalog, hall.id, pod.enclosure);
    expect(box).toBeDefined();
    if (!box) return;
    const pose = aislePose(box);
    const [x, y, z] = positionOf(pose);
    expect(x).toBeGreaterThanOrEqual(box.x0 - 0.01);
    expect(x).toBeLessThanOrEqual(box.x1 + 0.01);
    expect(z).toBeGreaterThanOrEqual(box.z0 - 0.01);
    expect(z).toBeLessThanOrEqual(box.z1 + 0.01);
    expect(y - box.y0).toBeCloseTo(EYE_M, 1);
    // an aisle that runs along x is looked at from its x end, one along z from its z end
    expect(pose.yaw).toBeCloseTo(runsAlongX(pod.enclosure) ? Math.PI / 2 : 0);
    expect(pose.pitch).toBeGreaterThan(0);
    expect(pose.pitch).toBeLessThan(0.3);
  });

  test("a short aisle still has the camera inside it, and a long one keeps it within six metres of the middle", () => {
    const short = aislePose({ x0: 0, x1: 2, y0: 0.6, y1: 2.9, z0: 0, z1: 1.2 });
    expect(short.distance).toBeLessThan(1);
    expect(short.distance).toBeCloseTo(0.9);
    const long = aislePose({ x0: 0, x1: 60, y0: 0.6, y1: 2.9, z0: 0, z1: 1.2 });
    expect(long.distance).toBe(6);
    const across = aislePose({ x0: 0, x1: 1.2, y0: 0.6, y1: 2.9, z0: 0, z1: 30 });
    expect(across.yaw).toBe(0);
  });

  test("it takes 0.6 seconds to walk in, and there is a way out that says so", () => {
    expect(WALK_IN_S).toBe(0.6);
    expect(LEAVE_HINT).toMatch(/Esc/);
    expect(LEAVE_HINT).toMatch(/복도 나가기/);
  });

  test("the breadcrumb says which containment you are in", () => {
    expect(insideLabel("컨테인먼트 A-1")).toBe("컨테인먼트 A-1 안");
    expect(insideLabel("A-1")).toBe("컨테인먼트 A-1 안");
    const focus = { kind: "room", id: hall.id } as const;
    const plain = crumbsOf(index, focus);
    const inside = crumbsOf(index, focus, pod.name);
    expect(inside).toHaveLength(plain.length + 1);
    expect(inside.at(-1)?.label).toBe(insideLabel(pod.name));
    // the crumb before it is the room, a way back out
    expect(inside.at(-2)?.focus).toEqual(focus);
    expect(crumbsOf(index, { kind: "site" }, pod.name)).toHaveLength(1);
  });

  test("the line a person walks runs down the middle of the aisle and stays off its ends", () => {
    const line = aisleLine(pod);
    const e = pod.enclosure;
    for (const p of [line.a, line.b]) {
      expect(p.x).toBeGreaterThanOrEqual(e.x0);
      expect(p.x).toBeLessThanOrEqual(e.x1);
      expect(p.z).toBeGreaterThanOrEqual(e.z0);
      expect(p.z).toBeLessThanOrEqual(e.z1);
    }
    expect(Math.hypot(line.b.x - line.a.x, line.b.z - line.a.z)).toBeGreaterThan(1);
  });
});

describe("people walk in the aisle that is looked into, and in no other [REQ-074] [ADR-0078]", () => {
  const centre = {
    x: (pod.enclosure.x0 + pod.enclosure.x1) / 2,
    z: (pod.enclosure.z0 + pod.enclosure.z1) / 2,
  };

  test("by default a containment is closed to walkers; the one looked into is open", () => {
    expect(podBlocks(scene).length).toBe(scene.pods.length);
    expect(podBlocks(scene, pod.id).length).toBe(scene.pods.length - 1);
    const closed = new Grid(scene, [...rackBlocks(scene), ...podBlocks(scene)]);
    const open = new Grid(scene, [...rackBlocks(scene), ...podBlocks(scene, pod.id)]);
    expect(closed.free(centre.x, centre.z)).toBe(false);
    expect(open.free(centre.x, centre.z)).toBe(true);
  });

  test("with an aisle looked into, the first engineer patrols it", () => {
    const crew = crewOf(scene, 7, pod.id);
    const first = crew.people.find((p) => p.role === "engineer");
    expect(first?.patrol).toBeDefined();
    const start = first?.patrol?.pts[0];
    expect(start?.x).toBeGreaterThanOrEqual(pod.enclosure.x0 - 0.01);
    expect(start?.x).toBeLessThanOrEqual(pod.enclosure.x1 + 0.01);
    expect(start?.z).toBeGreaterThanOrEqual(pod.enclosure.z0 - 0.01);
    expect(start?.z).toBeLessThanOrEqual(pod.enclosure.z1 + 0.01);
    expect(crew.grid.free(centre.x, centre.z)).toBe(true);
  });

  test("without it the crew is as before: nobody walks inside a containment", () => {
    const crew = crewOf(scene);
    expect(crew.grid.free(centre.x, centre.z)).toBe(false);
    for (const aisle of crew.aisles) {
      const mid = { x: (aisle.a.x + aisle.b.x) / 2, z: (aisle.a.z + aisle.b.z) / 2 };
      expect(
        mid.x > pod.enclosure.x0 &&
          mid.x < pod.enclosure.x1 &&
          mid.z > pod.enclosure.z0 &&
          mid.z < pod.enclosure.z1,
      ).toBe(false);
    }
    expect(crewOf(scene, 7)).toEqual(crewOf(scene, 7, undefined));
  });
});
