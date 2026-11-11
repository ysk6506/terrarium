import { InvalidValueError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { curveProblems, interpolate, parseWeatherCsv } from "./curve";
import { HAZARD_ROWS } from "./hazard-table";
import {
  DEFAULT_FINGERPRINT,
  fingerprintOf,
  isDefaultProfile,
  type PhysicsProfile,
  profileProblems,
} from "./profile";
import { SLOTS, splitName } from "./registry";
import { resolveProfile } from "./resolved";
import { SLOT_IDS } from "./types";

const HANGUL = /[가-힣]/;

describe("the thirteen slots are listed with units, defaults and ranges [REQ-113]", () => {
  test("every slot has a Korean name, a contract, a v1 description and places an override may name", () => {
    expect(Object.keys(SLOTS).sort()).toEqual([...SLOT_IDS].sort());
    expect(SLOT_IDS).toHaveLength(13);
    for (const s of Object.values(SLOTS)) {
      expect(s.ko, s.id).toMatch(HANGUL);
      expect(s.v1, s.id).toMatch(HANGUL);
      expect(s.scopes, s.id).toContain("world");
      expect(s.input.length, s.id).toBeGreaterThan(0);
      expect(s.output.length, s.id).toBeGreaterThan(0);
      for (const f of [...s.input, ...s.output]) expect(f.unit, `${s.id}.${f.name}`).not.toBe("");
    }
  });

  test("every number has a unit, a default inside its range and a line of Korean; every table's sample is a valid table", () => {
    for (const s of Object.values(SLOTS)) {
      for (const [name, p] of Object.entries(s.params)) {
        expect(p.default, `${s.id}.${name}`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${s.id}.${name}`).toBeLessThanOrEqual(p.max);
        expect(p.unit, `${s.id}.${name}`).not.toBe("");
        expect(p.ko, `${s.id}.${name}`).toMatch(HANGUL);
      }
      for (const [name, c] of Object.entries(s.curves)) {
        expect(curveProblems(`${s.id}.${name}`, c.sample, c), `${s.id}.${name}`).toEqual([]);
        expect(c.ko).toMatch(HANGUL);
      }
    }
  });

  test("the reliability slot has a number for every fault kind of the failure-rate table, and a scale", () => {
    const names = Object.keys(SLOTS["reliability.hazard"].params);
    expect(names).toContain("rateScale");
    for (const r of HAZARD_ROWS) expect(names).toContain(`mtbf.${r.type}`);
  });

  test("a full name splits into its slot and the number's or table's name", () => {
    expect(splitName("thermal.room.envelopeWPerKM2")).toEqual({
      slot: "thermal.room",
      name: "envelopeWPerKM2",
    });
    expect(splitName("reliability.hazard.mtbf.fan_failure")?.name).toBe("mtbf.fan_failure");
    expect(splitName("nothing.here")).toBeUndefined();
  });
});

describe("a profile is checked and fingerprinted [REQ-113]", () => {
  test("the default physics, empty overrides and numbers left at their default all have the fingerprint v1", () => {
    expect(fingerprintOf(undefined)).toBe(DEFAULT_FINGERPRINT);
    expect(fingerprintOf({ base: "v1" })).toBe("v1");
    expect(fingerprintOf({ base: "v1", params: {}, scoped: [], curves: {} })).toBe("v1");
    expect(fingerprintOf({ base: "v1", params: { "thermal.room.roomHeightM": 3 } })).toBe("v1");
    expect(isDefaultProfile({ base: "v1" })).toBe(true);
  });

  test("a changed number gives another fingerprint, the same content gives the same one whatever the order", () => {
    const a: PhysicsProfile = {
      base: "v1",
      params: { "thermal.room.roomHeightM": 4, "power.protection.tripFactor": 1.2 },
    };
    const b: PhysicsProfile = {
      base: "v1",
      params: { "power.protection.tripFactor": 1.2, "thermal.room.roomHeightM": 4 },
    };
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
    expect(fingerprintOf(a)).toMatch(/^v1\+[0-9a-f]{12}$/);
    expect(fingerprintOf({ base: "v1", params: { "thermal.room.roomHeightM": 5 } })).not.toBe(
      fingerprintOf(a),
    );
  });

  test("an unknown name, a number out of its range and a table out of order are refused in Korean, with every problem", () => {
    const problems = profileProblems({
      base: "v1",
      params: { "thermal.room.nope": 1, "thermal.room.roomHeightM": 99, "cooling.unit.cop": "x" },
      curves: {
        "power.protection.tripTimeCurve": [
          [2, 10],
          [1.5, 5],
        ],
        "power.device.noCurve": [
          [0, 0],
          [1, 1],
        ],
      },
    });
    expect(problems.join("\n")).toContain("알 수 없는 숫자 'thermal.room.nope'");
    expect(problems.join("\n")).toContain(
      "'thermal.room.roomHeightM'(99)이 허용 범위 1~20 m를 벗어나요",
    );
    expect(problems.join("\n")).toContain("'cooling.unit.cop'은 유한한 숫자여야 해요");
    expect(problems.join("\n")).toContain("x(1.5)가 앞 점보다 커야 해요");
    expect(problems.join("\n")).toContain("알 수 없는 곡선 'power.device.noCurve'");
    expect(problems.length).toBeGreaterThanOrEqual(5);
  });

  test("a scoped number must name a place its slot allows, and a base version that exists", () => {
    const problems = profileProblems({
      base: "v9",
      scoped: [
        { param: "reliability.hazard.rateScale", value: 2, scope: { kind: "room", id: "r1" } },
        { param: "thermal.room.roomHeightM", value: 4, scope: { kind: "planet", id: "x" } },
      ],
    });
    expect(problems.join("\n")).toContain("기본 물리 판 'v9'은 없어요");
    expect(problems.join("\n")).toContain("room 범위로 바꿀 수 없어요");
    expect(problems.join("\n")).toContain("범위 종류 'planet'");
  });

  test("a table's points must be inside the range of that table", () => {
    const out = profileProblems({
      base: "v1",
      curves: {
        "power.device.capPerfCurve": [
          [0, 0],
          [1, 2],
        ],
      },
    });
    expect(out.join("\n")).toContain("y(2)가 허용 범위 0~1를 벗어나요");
  });

  test("a profile that cannot be used is refused when it is made ready, with the reasons", () => {
    expect(() => resolveProfile({ base: "v1", params: { "thermal.room.nope": 1 } })).toThrow(
      InvalidValueError,
    );
  });
});

describe("tables are straight lines between points, flat past the ends, and always give the same answer [REQ-113]", () => {
  const pts = [
    [0, 0],
    [10, 100],
    [20, 100],
    [30, 0],
  ] as const;

  test("interpolation", () => {
    expect(interpolate(pts, -5)).toBe(0);
    expect(interpolate(pts, 5)).toBe(50);
    expect(interpolate(pts, 10)).toBe(100);
    expect(interpolate(pts, 25)).toBe(50);
    expect(interpolate(pts, 99)).toBe(0);
    expect(interpolate(pts, 7.3)).toBe(interpolate(pts, 7.3));
  });

  test("a weather file of time_s,outdoor_c[,humidity_pct] lines is read, a header skipped, a bad line reported", () => {
    const read = parseWeatherCsv(
      "time_s,outdoor_c,humidity_pct\n0,10,50\n43200,30,40\n86400,10\nx,y\n",
    );
    expect(read.rows).toEqual([
      { timeS: 0, outdoorC: 10, humidityPct: 50 },
      { timeS: 43200, outdoorC: 30, humidityPct: 40 },
      { timeS: 86400, outdoorC: 10 },
    ]);
    expect(read.problems).toEqual(["5번째 줄: time_s,outdoor_c[,humidity_pct] 숫자여야 해요"]);
  });

  test("the weather table gives the outdoor air by time, and repeats daily when asked", () => {
    const rows = [
      { timeS: 0, outdoorC: 10 },
      { timeS: 43_200, outdoorC: 30 },
    ];
    const held = resolveProfile({ base: "v1", weather: { rows } });
    expect(held.outdoorAt(21_600)).toBe(20);
    expect(held.outdoorAt(999_999)).toBe(30);
    const daily = resolveProfile({ base: "v1", weather: { rows, repeatS: 86_400 } });
    expect(daily.outdoorAt(21_600)).toBe(20);
    expect(daily.outdoorAt(86_400 + 21_600)).toBe(20);
    expect(daily.outdoorAt(64_800)).toBe(20);
    expect(resolveProfile(undefined).outdoorAt(0)).toBeUndefined();
  });
});

describe("a number changed for one place only: the more specific place wins [REQ-113]", () => {
  test("world, model, building, room and rack, in that order of strength", () => {
    const p = resolveProfile({
      base: "v1",
      params: { "thermal.room.roomHeightM": 4 },
      scoped: [
        { param: "thermal.room.roomHeightM", value: 5, scope: { kind: "building", id: "b1" } },
        { param: "thermal.room.roomHeightM", value: 6, scope: { kind: "room", id: "r1" } },
        { param: "thermal.room.roomHeightM", value: 7, scope: { kind: "rack", id: "k1" } },
      ],
    });
    expect(p.isScoped("thermal.room")).toBe(true);
    expect(p.isScoped("cooling.unit")).toBe(false);
    expect(p.at("thermal.room", ["x"]).roomHeightM).toBe(4);
    expect(p.at("thermal.room", ["m1", "b1"]).roomHeightM).toBe(5);
    expect(p.at("thermal.room", ["k1", "r1", "b1"]).roomHeightM).toBe(7);
    expect(p.at("thermal.room", ["r1", "b1"]).roomHeightM).toBe(6);
    expect(p.base("thermal.room").envelopeWPerKM2).toBe(2);
  });

  test("a model id is a place for a device slot, and its number loses to the rack's own", () => {
    const p = resolveProfile({
      base: "v1",
      scoped: [
        { param: "thermal.device.chipTauS", value: 8, scope: { kind: "model", id: "m1" } },
        { param: "thermal.device.chipTauS", value: 9, scope: { kind: "rack", id: "k1" } },
      ],
    });
    expect(p.at("thermal.device", ["m1"]).chipTauS).toBe(8);
    expect(p.at("thermal.device", ["k1", "m1"]).chipTauS).toBe(9);
    expect(p.at("thermal.device", ["zz"]).chipTauS).toBe(30);
  });
});
