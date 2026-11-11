import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_SHAPE, generateShaped } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { barSum, factLine, stripOf, trialLine } from "./one-card";
import type { Preview } from "./preview";

const catalog = new Catalog();
const world = generateShaped(DEFAULT_SHAPE, catalog).blueprint;
const index = new BlueprintIndex(world);
const rack = index
  .ofKind("rack")
  .find((r) => index.childrenOf(r.id).some((c) => c.kind === "server"));
const room = index.ofKind("room")[0];
const building = index.ofKind("building")[0];
if (!rack || !room || !building) throw new Error("the shaped world has no rack, room or building");

const preview = (over: Partial<Preview> = {}): Preview =>
  ({
    heat: new Map(),
    rooms: new Map(),
    alarms: [],
    alarmed: new Set(),
    seconds: 600,
    frames: [],
    ...over,
  }) as Preview;

describe("the one card and the bar at the foot say how the picked thing stands [REQ-102]", () => {
  test("a rack's strip covers its units and shows each device once", () => {
    const strip = stripOf(index, catalog, rack.id);
    const covered = strip.reduce((n, c) => n + c.height, 0);
    expect(covered).toBeGreaterThan(0);
    const devices = strip.flatMap((c) => (c.device ? [c.device.id] : []));
    expect(new Set(devices).size).toBe(devices.length);
    expect(devices.length).toBeGreaterThan(0);
  });

  test("a rack's fact line counts its servers, free units and demand against supply", () => {
    const line = factLine(index, catalog, rack);
    expect(line).toMatch(/^서버 \d+대 · 빈 곳 \d+U · .+ \/ .+$/);
  });

  test("a room's fact line is made of racks, servers, heat and cooling, a building's of rooms first", () => {
    expect(factLine(index, catalog, room)).toMatch(/^랙 .+ · 서버 .+ · 발열 .+ \/ 냉방 .+ kW$/);
    expect(factLine(index, catalog, building)).toMatch(/^서버룸 \d+개 · 랙 .+ · 서버 .+/);
  });

  test("a part that is none of these shows its model's name, and a trial run adds the air at its inlet", () => {
    const server = index.childrenOf(rack.id).find((c) => c.kind === "server");
    if (!server) throw new Error("no server");
    const plain = factLine(index, catalog, server);
    expect(plain.length).toBeGreaterThan(0);
    expect(plain).not.toContain("흡기");
    const hot = factLine(index, catalog, server, preview({ heat: new Map([[server.id, 27.34]]) }));
    expect(hot).toBe(`${plain} · 흡기 27.3°C`);
  });

  test("the bar at a level shows racks, servers, power left and cost; at a rack it shows that rack's own sums", () => {
    const level = { kind: "room", id: room.id } as const;
    const bar = barSum(index, catalog, level, undefined);
    expect(bar.map((p) => p.label)).toEqual(["랙", "서버", "전원 여유", undefined]);
    expect(bar[3]?.value).toMatch(/원$/);
    const atRack = barSum(index, catalog, level, rack);
    expect(atRack.map((p) => p.label)).toEqual(["이 랙", undefined, "서비스"]);
    expect(atRack[2]?.value).toMatch(/^\d+개$/);
  });

  test("the power that is left is marked bad with a minus sign when the site gives less than it draws", () => {
    const level = { kind: "room", id: room.id } as const;
    const site = { capacity: { mw: 0.001 }, usedW: 5000 } as unknown as Parameters<
      typeof barSum
    >[4];
    const left = barSum(index, catalog, level, undefined, site).find(
      (p) => p.label === "전원 여유",
    );
    expect(left).toMatchObject({ bad: true });
    expect(left?.value.startsWith("−")).toBe(true);
    const plenty = { capacity: { mw: 5 }, usedW: 1000 } as unknown as Parameters<typeof barSum>[4];
    const ok = barSum(index, catalog, level, undefined, plenty).find(
      (p) => p.label === "전원 여유",
    );
    expect(ok?.bad).toBeUndefined();
    expect(ok?.value.startsWith("−")).toBe(false);
  });

  test("a trial run's line has its minutes, its alarms and the hottest inlet", () => {
    const level = { kind: "room", id: room.id } as const;
    const line = trialLine(
      preview({
        hottest: { id: rack.id, name: "r", inletC: 27.4 },
        alarms: [{}, {}] as unknown as Preview["alarms"],
      }),
      index,
      catalog,
      level,
    );
    expect(line.head).toBe("시운전 10분");
    expect(line.alarms).toBe("알람 2건");
    expect(line.rest).toContain("가장 더운 곳 27°C");
    expect(trialLine(preview(), index, catalog, level).rest).not.toContain("가장 더운 곳");
  });
});
