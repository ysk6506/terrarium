/**
 * Step 3 of an import: fill in what the graph does not hold but a simulation needs (REQ-010).
 * cloud_topology has no power chain, so racks get A/B PDUs, rooms A/B panels and floors A/B UPSes,
 * sized for the expected load. Racks with no cooling relationship are cooled by their room's units;
 * a room with racks and no units gets N+1 CRAHs. Everything added is marked `synthesized` and said
 * in the report. Real equipment is never resized: undersized real cooling is reported, not fixed.
 */
import { type Catalog, panelCapacityW } from "@terrarium/core/catalog";
import type { EquipmentSpec } from "@terrarium/core/sources";
import type { Plan, PlannedRoom } from "./resolve";

const PDU_MODEL = "pdu-17kw";
const PANEL_MODEL = "panel-400a";
const UPS_MODEL = "ups-500kva";
const CRAH_MODEL = "crah-100kw";
const SIZING_UTIL = 0.6;
const HEADROOM = 0.8;
const SYNTH = { synthesized: true } as const;

export interface Synthesis {
  readonly floorItems: Map<string, EquipmentSpec[]>;
  readonly assumptions: string[];
}

const units = (loadW: number, capacityW: number) =>
  Math.max(1, Math.ceil(loadW / (HEADROOM * capacityW)));

/** Expected draw of a device at a typical utilisation. */
function expectedW(catalog: Catalog, modelId: string): number {
  const model = catalog.get(modelId);
  if ("maxPowerW" in model)
    return model.idlePowerW + (model.maxPowerW - model.idlePowerW) * SIZING_UTIL;
  return "powerW" in model ? model.powerW : 0;
}

function roomLoadW(catalog: Catalog, room: PlannedRoom): number {
  return room.devices.reduce((sum, d) => sum + expectedW(catalog, d.modelId), 0);
}

function powerRoom(
  plan: Plan,
  catalog: Catalog,
  room: PlannedRoom,
  ups: { a: string[]; b: string[] },
): number {
  const load = roomLoadW(catalog, room);
  const panelW = panelCapacityW(catalog.getOf(PANEL_MODEL, "power_panel"));
  const perSide = units(load, panelW);
  const panels = { a: [] as string[], b: [] as string[] };
  for (const side of ["a", "b"] as const)
    for (let i = 1; i <= perSide; i++) {
      const id = `${room.id}-pnl-${side}${i}`;
      room.equipment.push({
        id,
        kind: "power_panel",
        name: `PNL-${room.name}-${side.toUpperCase()}${i}`,
        modelId: PANEL_MODEL,
        props: SYNTH,
      });
      plan.kinds.set(id, "power_panel");
      panels[side].push(id);
      plan.links.push({
        kind: "power",
        from: id,
        to: ups[side][(i - 1) % ups[side].length] as string,
        props: {},
      });
    }
  const racks = room.racks.filter((r) => room.devices.some((d) => d.rackId === r.id));
  racks.forEach((rack, n) => {
    for (const side of ["a", "b"] as const) {
      const id = `${rack.id}-pdu-${side}`;
      room.devices.push({
        id,
        kind: "pdu",
        name: `PDU-${rack.name}-${side.toUpperCase()}`,
        modelId: PDU_MODEL,
        hint: { floorInfo: {}, unit: 1, unitSpan: 1 },
        rackId: rack.id,
        props: SYNTH,
      });
      plan.kinds.set(id, "pdu");
      plan.links.push({
        kind: "power",
        from: id,
        to: panels[side][n % perSide] as string,
        props: {},
      });
      for (const d of room.devices.filter((x) => x.rackId === rack.id && x.kind !== "pdu"))
        plan.links.push({ kind: "power", from: d.id, to: id, props: {} });
    }
  });
  const coolers = room.equipment.filter((e) => e.kind === "cooling_unit");
  coolers.forEach((e, i) => {
    const panel = (i % 2 === 0 ? panels.a : panels.b)[0] as string;
    plan.links.push({ kind: "power", from: e.id, to: panel, props: {} });
  });
  return load;
}

function power(plan: Plan, catalog: Catalog, out: Synthesis): void {
  const upsW = catalog.getOf(UPS_MODEL, "ups").capacityKw * 1000;
  for (const [floorKey, floor] of plan.floors) {
    const rooms = [...plan.rooms.values()].filter(
      (r) => r.floorKey === floorKey && r.devices.length > 0,
    );
    if (rooms.length === 0) continue;
    const load = rooms.reduce((sum, r) => sum + roomLoadW(catalog, r), 0);
    const perSide = units(load, upsW);
    const ups = { a: [] as string[], b: [] as string[] };
    const items: EquipmentSpec[] = [];
    for (const side of ["a", "b"] as const)
      for (let i = 1; i <= perSide; i++) {
        const id = `${floor.id}-ups-${side}${i}`;
        items.push({
          id,
          kind: "ups",
          name: `UPS-${floor.name}-${side.toUpperCase()}${i}`,
          modelId: UPS_MODEL,
          props: SYNTH,
        });
        plan.kinds.set(id, "ups");
        ups[side].push(id);
      }
    out.floorItems.set(floorKey, items);
    for (const room of rooms) powerRoom(plan, catalog, room, ups);
  }
  out.assumptions.push(
    "그래프에 전력 정보가 없어 랙마다 A/B PDU, 서버룸마다 A/B 분전반, 층마다 A/B UPS를 부하에 맞춰 가정했어요 (synthesized 표시)",
  );
}

function cooling(plan: Plan, catalog: Catalog, out: Synthesis): void {
  const crahW = catalog.getOf(CRAH_MODEL, "cooling_unit").capacityKw * 1000;
  let inferred = 0;
  for (const room of plan.rooms.values()) {
    if (room.racks.length === 0) continue;
    let unitsHere = room.equipment.filter((e) => e.kind === "cooling_unit");
    const load = roomLoadW(catalog, room);
    if (unitsHere.length === 0) {
      const count = units(load, crahW) + 1;
      for (let i = 1; i <= count; i++) {
        const id = `${room.id}-crah${i}`;
        room.equipment.push({
          id,
          kind: "cooling_unit",
          name: `CRAH-${room.name}-${i}`,
          modelId: CRAH_MODEL,
          props: SYNTH,
        });
        plan.kinds.set(id, "cooling_unit");
      }
      unitsHere = room.equipment.filter((e) => e.kind === "cooling_unit");
      out.assumptions.push(`${room.name}: 냉방 설비 정보가 없어 CRAH ${count}대(N+1)를 가정했어요`);
    } else {
      const capacity = unitsHere.reduce(
        (sum, u) => sum + catalog.getOf(u.modelId, "cooling_unit").capacityKw * 1000,
        0,
      );
      if (capacity < load)
        out.assumptions.push(
          `${room.name}: 실제 냉방 용량(${Math.round(capacity / 1000)} kW)이 예상 부하(${Math.round(load / 1000)} kW)보다 작아요. 실제 장비라 늘리지 않았어요`,
        );
    }
    const cooled = new Set(plan.links.filter((l) => l.kind === "cooling").map((l) => l.from));
    for (const rack of room.racks.filter((r) => !cooled.has(r.id))) {
      for (const unit of unitsHere)
        plan.links.push({ kind: "cooling", from: rack.id, to: unit.id, props: { inferred: true } });
      inferred++;
    }
  }
  if (inferred > 0)
    out.assumptions.push(
      `냉방 관계가 없는 랙 ${inferred}개는 같은 서버룸의 냉방기가 식힌다고 가정했어요`,
    );
}

export function synthesize(
  plan: Plan,
  catalog: Catalog,
  assume: { power: boolean; cooling: boolean },
): Synthesis {
  const out: Synthesis = { floorItems: new Map(), assumptions: [] };
  // Cooling first, so units it adds are fed by the power chain added next.
  if (assume.cooling) cooling(plan, catalog, out);
  if (assume.power) power(plan, catalog, out);
  return out;
}
