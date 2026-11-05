import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  type Crew,
  type CrewWorld,
  crewAt,
  crewOf,
  NO_TROUBLE,
  nextWorld,
  spotOf,
  WALK_MPS,
} from "./crew";
import { CREW_LINES, lineFor } from "./crew-lines";
import { deviceIn, troubleKey, troubleOf } from "./crew-world";
import { insideScene, type RoomScene, roomScene } from "./room";

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
const scenes = index
  .ofKind("room")
  .map((r) => roomScene(index, catalog, r.id))
  .filter((s): s is RoomScene => s !== undefined);
const hall = scenes.find((s) => s.purpose === "data_hall" && s.racks > 8) as RoomScene;
const crew = crewOf(hall);
const engineers = crew.people.filter((p) => p.role === "engineer");
const unit = [...crew.devices].find(([, d]) => !d.rack);
const rackId = [...crew.devices].find(([, d]) => d.rack)?.[0] as string;

const trouble = (device: string, over: Partial<CrewWorld> = {}): CrewWorld => ({
  alarms: [{ device, severity: "warning", ageS: 10 }],
  activity: [],
  from: 100,
  ...over,
});

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("people in the server room [REQ-074]", () => {
  test("every room has at most four people, and only the roles of the decision", () => {
    expect(scenes.length).toBeGreaterThan(2);
    for (const s of scenes) {
      const c = crewOf(s);
      expect(c.people.length).toBeLessThanOrEqual(4);
      expect(c.people.filter((p) => p.role === "engineer").length).toBeGreaterThanOrEqual(1);
      expect(c.people.filter((p) => p.role === "engineer").length).toBeLessThanOrEqual(2);
      expect(c.people.filter((p) => p.role === "manager")).toHaveLength(1);
    }
  });

  test("a control room has its manager sitting at a desk, other rooms by the door", () => {
    const noc = scenes.find((s) => s.purpose === "noc");
    if (noc) {
      const c = crewOf(noc);
      const m = crewAt(c, 0).find((p) => p.role === "manager");
      expect(m?.pose).toBe("sit");
      expect(c.desk).toBeDefined();
    }
    const m = crewAt(crew, 0).find((p) => p.role === "manager");
    expect(m?.pose).toBe("stand");
  });

  test("the same room always has the same people", () => {
    expect(crewOf(hall).people).toEqual(crew.people);
  });

  test("on patrol everyone stays inside the outline and nobody jumps", () => {
    for (const s of scenes) {
      const c = crewOf(s);
      let last = crewAt(c, 0);
      for (let t = 0.2; t < 400; t += 0.2) {
        const now = crewAt(c, t);
        for (const [i, p] of now.entries()) {
          expect(insideScene(s, p.x, p.z)).toBe(true);
          expect(dist(p, last[i] as { x: number; z: number })).toBeLessThanOrEqual(
            1.6 * 0.2 + 0.05,
          );
        }
        last = now;
      }
    }
  });

  test("a place in the past is a place in the future: positions come from the time alone", () => {
    const a = crewAt(crew, 123.4);
    crewAt(crew, 900);
    expect(crewAt(crew, 123.4)).toEqual(a);
  });

  test("an alarm on a machine sends an engineer there on foot, who then works in front of it", () => {
    const device = unit?.[0] ?? rackId;
    const world = trouble(device);
    const spot = spotOf(crew, device) as { x: number; z: number };
    const first = crewAt(crew, 100, world).find((p) => p.device === device);
    expect(first?.role).toBe("engineer");
    expect(first?.pose).toBe("walk");
    expect(first?.situation).toBe("going");
    let last = first as { x: number; z: number };
    for (let t = 100.5; t < 100 + 120; t += 0.5) {
      const p = crewAt(crew, t, world).find((q) => q.device === device) as { x: number; z: number };
      expect(dist(p, last)).toBeLessThanOrEqual(WALK_MPS * 0.5 + 0.01);
      last = p;
    }
    const there = crewAt(crew, 400, world).find((p) => p.device === device);
    expect(there?.pose).toBe("work");
    expect(there?.situation).toBe("working");
    expect(dist(there as { x: number; z: number }, spot)).toBeLessThan(0.01);
  });

  test("the nearest engineer goes, the other one keeps patrolling", () => {
    const world = trouble(rackId);
    const spot = spotOf(crew, rackId) as { x: number; z: number };
    const before = crewAt(crew, 100).filter((p) => p.role === "engineer");
    const nearest = [...before].sort((a, b) => dist(a, spot) - dist(b, spot))[0];
    const now = crewAt(crew, 101, world);
    expect(now.find((p) => p.device === rackId)?.id).toBe(nearest?.id);
    expect(now.filter((p) => p.role === "engineer" && p.device === undefined)).toHaveLength(
      engineers.length - 1,
    );
  });

  test("a long critical alarm brings a technician in at the door; a short one does not", () => {
    const device = rackId;
    const short = crewAt(crew, 200, {
      alarms: [{ device, severity: "critical", ageS: 60 }],
      activity: [],
      from: 100,
    });
    expect(short.find((p) => p.role === "technician")?.present).toBe(false);
    const world: CrewWorld = {
      alarms: [{ device, severity: "critical", ageS: 300 }],
      activity: [],
      from: 100,
    };
    const start = crewAt(crew, 100, world).find((p) => p.role === "technician");
    expect(start?.present).toBe(true);
    expect(dist(start as { x: number; z: number }, crew.door)).toBeLessThan(0.5);
    const done = crewAt(crew, 600, world).find((p) => p.role === "technician");
    expect(done?.pose).toBe("work");
    expect(done?.situation).toBe("technician");
    // Beside the engineer, not inside them.
    const eng = crewAt(crew, 600, world).find((p) => p.role === "engineer" && p.device === device);
    if (eng) expect(dist(done as { x: number; z: number }, eng)).toBeGreaterThan(0.5);
  });

  test("a new alarm while walking, then a clear, never makes anyone jump [REQ-074]", () => {
    const other = [...crew.devices].filter(([, d]) => d.rack)[5]?.[0] as string;
    const a: CrewWorld = {
      alarms: [{ device: rackId, severity: "warning", ageS: 5 }],
      activity: [],
      from: 100,
    };
    const b = nextWorld(
      a,
      { alarms: [{ device: other, severity: "warning", ageS: 5 }], activity: [] },
      103,
    );
    const c = nextWorld(b, { alarms: [], activity: [] }, 109);
    const worlds = [a, b, c];
    const bounds = [100, 103, 109, 300];
    let last: ReturnType<typeof crewAt> | undefined;
    for (let t = 100; t < 300; t += 0.2) {
      const k = bounds.findIndex((s, i) => t >= s && t < (bounds[i + 1] as number));
      const now = crewAt(crew, t, worlds[k] as CrewWorld);
      if (last)
        for (const [i, p] of now.entries()) {
          const q = last[i] as { x: number; z: number; present: boolean };
          if (p.present && q.present) expect(dist(p, q)).toBeLessThanOrEqual(1.6 * 0.2 + 0.1);
        }
      last = now;
    }
  });

  test("a run that acted on a machine sends an engineer, marked for the agent", () => {
    const world: CrewWorld = { alarms: [], activity: [{ device: rackId, runId: "r1" }], from: 50 };
    const there = crewAt(crew, 500, world).find((p) => p.device === rackId);
    expect(there?.forAgent).toBe(true);
    expect(there?.pose).toBe("work");
    expect(there?.situation).toBe("agent");
  });

  test("when the alarm clears they walk back to the patrol without jumping, and the technician leaves", () => {
    const alarm: CrewWorld = {
      alarms: [{ device: rackId, severity: "critical", ageS: 300 }],
      activity: [],
      from: 100,
    };
    const cleared: CrewWorld = { ...NO_TROUBLE, from: 400, before: alarm };
    let last = crewAt(crew, 399.8, alarm);
    for (let t = 400; t < 520; t += 0.2) {
      const now = crewAt(crew, t, cleared);
      for (const [i, p] of now.entries()) {
        const q = last[i] as { x: number; z: number; present: boolean };
        if (p.present && q.present) expect(dist(p, q)).toBeLessThanOrEqual(1.6 * 0.2 + 0.1);
      }
      last = now;
    }
    const later = crewAt(crew, 900, cleared);
    expect(later.find((p) => p.role === "technician")?.present).toBe(false);
    expect(later.every((p) => p.device === undefined)).toBe(true);
    expect(later.filter((p) => p.role === "engineer").every((p) => p.situation === "patrol")).toBe(
      true,
    );
  });

  test("with less motion everyone stands, at the machine if one called them", () => {
    const world = trouble(rackId);
    for (const p of crewAt(crew, 77, world, { still: true }))
      expect(["stand", "sit"]).toContain(p.pose);
    const still = crewAt(crew, 77, world, { still: true });
    const again = crewAt(crew, 5000, world, { still: true });
    expect(again).toEqual(still);
  });

  test("an alarm on a server counts for its rack, and one in another room counts for nothing", () => {
    const server = index.ofKind("server").find((s) => deviceIn(index, crew, s.id) !== undefined);
    expect(server).toBeDefined();
    const other = scenes.find((s) => s.id !== hall.id && s.racks > 0) as RoomScene;
    const outside = crewOf(other);
    const input = {
      alarms: [{ entityId: server?.id as string, severity: "critical" as const, since: 0 }],
      t: 300,
      workers: [],
      now: 0,
    };
    const here = troubleOf(index, crew, input);
    expect(here.alarms).toHaveLength(1);
    expect(here.alarms[0]?.ageS).toBe(300);
    expect(troubleOf(index, outside, input).alarms).toEqual([]);
    expect(troubleKey(here)).not.toBe(troubleKey({ alarms: [], activity: [] }));
  });

  test("the roles are what the decision says and the room is not left empty of crew", () => {
    const c: Crew = crewOf(hall);
    expect(c.people.map((p) => p.role).sort()).toEqual(
      [...engineers.map(() => "engineer"), "manager", "technician"].sort(),
    );
    expect(roomPurposeOf(index.entity(hall.id))).toBe("data_hall");
  });

  test("the lines are 3 to 5 for every situation and they go round [REQ-074]", () => {
    for (const lines of Object.values(CREW_LINES)) {
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(5);
    }
    const p = { id: 0 };
    const said = CREW_LINES.patrol.map((_, n) => lineFor(p, "patrol", n));
    expect(new Set(said).size).toBe(CREW_LINES.patrol.length);
    expect(lineFor(p, "patrol", CREW_LINES.patrol.length)).toBe(lineFor(p, "patrol", 0));
    expect(lineFor({ id: 1 }, "patrol", 0)).not.toBe(lineFor({ id: 0 }, "patrol", 0));
    expect(lineFor(p, "going", 0, "CRAH-1F-A-1")).toContain("CRAH-1F-A-1");
    expect(lineFor(p, "going", 0)).not.toContain("{device}");
  });
});
