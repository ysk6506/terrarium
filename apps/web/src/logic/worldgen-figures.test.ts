import {
  DEFAULT_SHAPE,
  planShape,
  type ServiceDraft,
  type ShapedResult,
} from "@terrarium/core/sources/worldgen";
import { describe, expect, test } from "vitest";
import { doneLine, planFigures } from "./worldgen-scale";

const figures = (
  over: Partial<typeof DEFAULT_SHAPE> = {},
  layers: Partial<typeof DEFAULT_SHAPE.layers> = {},
) => {
  const spec = { ...DEFAULT_SHAPE, ...over, layers: { ...DEFAULT_SHAPE.layers, ...layers } };
  return planFigures(planShape(spec), spec.layers);
};
const units = (rows: ReturnType<typeof figures>) => rows.map((r) => r.unit);

describe("the figures under the server count follow the layers that were chosen [REQ-094] [REQ-107]", () => {
  test("a plain world shows racks, rooms, switches, PDUs, cooling units and kW, in that order", () => {
    const rows = figures({ servers: 480 });
    expect(units(rows).map((u) => u.split(" · ")[0])).toEqual([
      "랙",
      "서버룸",
      "스위치",
      "PDU",
      "냉방기",
      "kW",
    ]);
    expect(rows[0]?.unit).toMatch(/^랙 · \d+대씩$/);
  });

  test("GPUs add their own row and the kW row says how much of it is theirs", () => {
    const rows = figures({ servers: 48 }, { accel: "gpu-training-cluster" });
    const gpu = rows.find((r) => r.unit.startsWith("GPU"));
    expect(gpu?.unit).toMatch(/^GPU · 서버 \d+대$/);
    expect(rows.at(-1)?.unit).toMatch(/^kW · GPU .+ kW 포함$/);
  });

  test("liquid cooling adds the CDU row", () => {
    const rows = figures({ servers: 48 }, { accel: "gpu-liquid-pod", cooling: "cool-liquid" });
    expect(units(rows)).toContain("CDU · 액체 냉각");
  });

  test("a power chip with batteries or a substation names them under the PDU row", () => {
    const rows = figures({ servers: 48 }, { power: "pwr-rack-bbu" });
    expect(rows.find((r) => r.unit.startsWith("PDU"))?.unit).toContain("랙 BBU");
    const sub = figures({ servers: 48 }, { power: "pwr-substation" });
    expect(sub.find((r) => r.unit.startsWith("PDU"))?.unit).toContain("자체 변전소");
  });
});

describe("the line after making a world counts what was built [REQ-094]", () => {
  const counts = (over: Partial<ShapedResult["counts"]> = {}) =>
    ({
      servers: 480,
      racks: 24,
      baseRacks: 0,
      rooms: 1,
      buildings: 1,
      sites: 0,
      vms: 0,
      services: 1,
      serviceVms: 0,
      serviceHosts: 3,
      switches: 4,
      ...over,
    }) as ShapedResult["counts"];
  const services = [{ name: "포털" }, { name: "결제" }] as ServiceDraft[];

  test("services on their own servers are counted as servers", () => {
    expect(doneLine(counts(), services, 14)).toBe(
      "세계를 다 지었어요 — 서버룸 1 · 랙 24 · 서버 480 · 포털 · 결제(서버 3) · 시나리오 14개",
    );
  });

  test("services in VMs are counted as hosts and VMs, and several buildings or sites come first", () => {
    expect(doneLine(counts({ serviceVms: 9, buildings: 2 }), services, 3)).toContain(
      "건물 2 · 서버룸 1",
    );
    expect(doneLine(counts({ serviceVms: 9 }), services, 3)).toContain("(호스트 3 · VM 9)");
    expect(doneLine(counts({ sites: 2, buildings: 2 }), services, 3)).toContain(
      "사이트 2 · 서버룸",
    );
  });
});
