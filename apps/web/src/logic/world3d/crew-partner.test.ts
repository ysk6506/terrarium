import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type ActivityState, applyActivity, noActivity } from "../activity";
import { type CrewWorld, crewAt, crewOf, nextWorld, spotOf, WALK_MPS } from "./crew";
import { CREW_LINES, lineFor } from "./crew-lines";
import { troubleKey, troubleOf } from "./crew-world";
import { type RoomScene, roomScene } from "./room";

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
  .map((r) => roomScene(index, catalog, r.id))
  .find(
    (s): s is RoomScene => s !== undefined && s.purpose === "data_hall" && s.racks > 8,
  ) as RoomScene;
const crew = crewOf(hall);
const device = [...crew.devices].find(([, d]) => d.rack)?.[0] as string;
const technician = crew.people.find((p) => p.role === "technician");

const partnerWorld = (over: Partial<CrewWorld> = {}): CrewWorld => ({
  alarms: [],
  activity: [],
  partners: [{ device, text: "교체 중 · 벤더", replacing: true }],
  from: 100,
  ...over,
});

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("an engineer from another team comes in and works on the machine [REQ-093]", () => {
  test("the technician steps in at the door, walks at walking speed to the machine and takes the working pose", () => {
    const world = partnerWorld();
    const spot = spotOf(crew, device, true) as { x: number; z: number };
    const first = crewAt(crew, 100, world).find((p) => p.id === technician?.id);
    expect(first).toMatchObject({
      present: true,
      pose: "walk",
      forPartner: true,
      situation: "partner",
      device,
    });
    expect(dist(first as { x: number; z: number }, crew.door)).toBeLessThan(0.1);
    const way = dist(crew.door, spot);
    const midway = crewAt(crew, 100 + (way / WALK_MPS) * 0.5, world).find(
      (p) => p.id === technician?.id,
    );
    expect(midway?.pose).toBe("walk");
    const there = crewAt(crew, 100 + (way * 3) / WALK_MPS + 60, world).find(
      (p) => p.id === technician?.id,
    );
    expect(there?.pose).toBe("work");
    expect(dist(there as { x: number; z: number }, spot)).toBeLessThan(0.5);
  });

  test("when the work is done the technician walks back to the door and leaves; nobody jumps", () => {
    const working = partnerWorld();
    const done = nextWorld(working, { alarms: [], activity: [] }, 3000);
    const states = (t: number) => crewAt(crew, t, done).find((p) => p.id === technician?.id);
    expect(states(3000)).toMatchObject({ present: true, pose: "walk" });
    const way = dist(spotOf(crew, device, true) as { x: number; z: number }, crew.door);
    expect(states(3000 + (way * 3) / WALK_MPS + 120)).toMatchObject({ present: false });
    let last = states(3000) as { x: number; z: number };
    for (let t = 3000.2; t < 3060; t += 0.2) {
      const now = states(t) as { x: number; z: number };
      expect(dist(now, last)).toBeLessThanOrEqual(1.6 * 0.2 + 0.05);
      last = now;
    }
  });

  test("the hand-off comes before an alarm's call, and the person says something that is not a claim of having fixed it", () => {
    const world = partnerWorld({
      alarms: [{ device, severity: "critical", ageS: 600 }],
    });
    const person = crewAt(crew, 400, world).find((p) => p.id === technician?.id);
    expect(person?.situation).toBe("partner");
    expect(CREW_LINES.partner.length).toBeGreaterThanOrEqual(3);
    for (const line of CREW_LINES.partner) {
      expect(line).not.toMatch(/고쳤|해결했|복구했/);
    }
    expect(lineFor({ id: 3 }, "partner", 0, "랙 A-01")).toContain("랙 A-01");
  });

  test("a team's work at a console brings nobody into the room, and the work is part of what makes a new walk", () => {
    const state: ActivityState = [
      {
        type: "partner",
        runId: "r1",
        t: 1,
        handoff: "h1",
        device,
        what: "started",
        team: "네트워크 팀",
        who: "team",
        replacing: false,
        onSite: false,
      },
    ].reduce((s, e) => applyActivity(s, e as never, 0), noActivity);
    expect(
      troubleOf(index, crew, {
        alarms: [],
        t: 0,
        workers: [],
        partners: state.partners ?? [],
        now: 0,
      }).partners,
    ).toBeUndefined();
    const onSite = applyActivity(
      noActivity,
      {
        type: "partner",
        runId: "r1",
        t: 1,
        handoff: "h1",
        device,
        what: "started",
        team: "서버 팀",
        who: "vendor",
        replacing: true,
        onSite: true,
      },
      0,
    );
    const trouble = troubleOf(index, crew, {
      alarms: [],
      t: 0,
      workers: [],
      partners: onSite.partners ?? [],
      now: 0,
    });
    expect(trouble.partners).toEqual([{ device, replacing: true, text: "교체 중 · 벤더" }]);
    expect(troubleKey(trouble)).not.toBe(troubleKey({ alarms: [], activity: [] }));
  });

  test("the activity of a world keeps who works where until it is done or the run ends", () => {
    const start = {
      type: "partner",
      runId: "r1",
      t: 1,
      handoff: "h1",
      device: "srv-a1",
      what: "started",
      team: "서버 팀",
      who: "vendor",
      replacing: true,
      onSite: true,
    } as const;
    const a = applyActivity(noActivity, start, 0);
    expect(a.partners).toHaveLength(1);
    expect(applyActivity(a, start, 1).partners).toHaveLength(1);
    expect(applyActivity(a, { ...start, what: "done" }, 2).partners).toEqual([]);
    expect(applyActivity(a, { type: "end", runId: "r1" }, 2).partners).toEqual([]);
  });
});
