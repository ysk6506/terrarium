import type { EntityState } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { NO_IMPACT } from "./impact";
import { lineOf } from "./lines";
import { LAYER_IDS, LAYER_LABELS, type TileClass, type TopoKind } from "./types";
import { classLabel, groupName, impactCounts, impactWhen, num } from "./words";

/** The glossary's retired words (docs/design-docs/glossary.md), and the two alarm levels' retired names. */
const RETIRED = [
  "도구",
  "삭제",
  "수정",
  "취소",
  "월드",
  "배점",
  "까닭",
  "경보",
  "가동",
  "한도",
  "노출",
  "장애",
  "주입",
  "위험",
  "주의",
];

const CLASSES: TileClass[] = ["fault", "alarm", "touch", "impact", "ok"];
const KINDS: TopoKind[] = [
  "feed",
  "generator",
  "ups",
  "panel",
  "pdu",
  "chiller",
  "cdu",
  "crah",
  "room",
  "rack",
  "server",
  "switch",
  "storage",
  "vm",
  "cluster",
]; // prettier-ignore

const STATES: EntityState[] = [
  {
    kind: "chiller",
    health: "ok",
    adminOn: true,
    powered: true,
    running: false,
    supplyC: 7,
    returnC: 12,
    loadKw: 0,
    capacityKw: 1000,
    powerW: 0,
  },
  {
    kind: "cooling_unit",
    health: "ok",
    adminOn: true,
    powered: true,
    running: true,
    setpointC: 20,
    supplyC: 18,
    returnC: 30,
    loadKw: 46,
    capacityKw: 50,
  },
  { kind: "room", health: "ok", ambientC: 27.44 },
  { kind: "pdu", health: "ok", powered: true, tripped: true, loadW: 0 },
  { kind: "ups", health: "ok", inputOk: false, onBattery: true, batteryPct: 61.4, loadW: 90_000 },
  {
    kind: "generator",
    health: "ok",
    adminOn: true,
    phase: "failed",
    startedFor: 0,
    fuelPct: 90,
    loadKw: 0,
  },
  { kind: "switch", health: "ok", adminOn: true, powered: false, powerW: 0 },
]; // prettier-ignore

describe("the words of the board follow the glossary [REQ-078]", () => {
  const sentences = (): string[] => {
    const out: string[] = [];
    for (const layer of LAYER_IDS) {
      out.push(LAYER_LABELS[layer]);
      for (const cls of CLASSES) {
        out.push(classLabel(cls, layer));
        for (const kind of KINDS) out.push(groupName(cls, layer, kind, "단계", 12_345));
        out.push(groupName(cls, layer, undefined, "랙·서버", 3));
      }
      for (const state of STATES) out.push(lineOf(state, layer));
    }
    out.push(impactCounts({ ...NO_IMPACT, servers: 108_000 }));
    for (const when of [
      { kind: "thermal", minutes: 12, celsius: 32 },
      { kind: "thermal", minutes: 0, celsius: 32 },
      { kind: "power", minutes: 0, celsius: 32 },
    ] as const)
      out.push(impactWhen({ ...NO_IMPACT, severe: when }));
    return out;
  };

  test("no word the glossary retired", () => {
    for (const text of sentences()) for (const word of RETIRED) expect(text).not.toContain(word);
  });

  test("the sentences end in 해요체 or in a noun phrase, never in ~니다 or ~다", () => {
    for (const text of sentences().filter((t) => t.length > 0)) {
      expect(text).not.toMatch(/니다\.?$/);
      expect(text).not.toMatch(/[가-힣]다\.?$/);
    }
  });

  test("numbers are Arabic numerals with their units, with thousands separated", () => {
    expect(num(16_572)).toBe("16,572");
    expect(groupName("ok", "cooling", "rack", "랙", 408)).toBe("정상 랙 408대");
    expect(groupName("impact", "cooling", "rack", "랙", 11)).toBe("더워지는 중 랙 11대");
    expect(impactCounts({ ...NO_IMPACT, servers: 108 })).toBe("서버룸 0 · 랙 0 · 서버 108");
  });
});
