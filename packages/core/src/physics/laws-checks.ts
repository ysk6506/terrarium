/**
 * The checks of the physics laws (REQ-113, ADR-0137): each takes what a step left in the world and returns the violations,
 * in Korean. The laws hold whatever the models are: energy is not made, a cooling unit removes no more than it can, a battery
 * gives no more than it had, a supplier carries what its consumers draw (over its efficiency), a device draws between idle and
 * its maximum. Tolerances are relative, so a big room and a small one are held to the same standard.
 */
import type { ServerModel, UpsModel } from "@terrarium/core/catalog";
import { interpolate, type SlotValues } from "@terrarium/core/physics/slots";
import type { EntityState, World } from "@terrarium/core/world";
import { capPerf, serverDrawW, upsEfficiencyAt } from "./models";
import { drawW, passOf, SupplyResolver } from "./power";
import { SUPPLIER_KINDS } from "./power-plan";
import { faultParam } from "./power-supply";
import type { RoomStep } from "./thermal";

export type LawId =
  | "format"
  | "range"
  | "energy.room"
  | "energy.cooling"
  | "energy.battery"
  | "power.chain"
  | "power.device"
  | "direction.load"
  | "direction.cooling";

export interface Violation {
  readonly law: LawId;
  /** The entity or place it happened at. */
  readonly where: string;
  readonly t: number;
  readonly message: string;
}

/** Relative tolerance of a balance: floating-point sums in a different order differ in the last digits, never more. */
const REL = 1e-9;
const TEMP_MIN_C = -40;
const TEMP_MAX_C = 150;

const v = (law: LawId, where: string, t: number, message: string): Violation => ({
  law,
  where,
  t,
  message,
});

/** Every number in the states of the world is finite. */
export function formatViolations(world: World): Violation[] {
  const out: Violation[] = [];
  const t = world.time();
  for (const [i, s] of world.stateList().entries()) {
    for (const [key, value] of Object.entries(s as unknown as Record<string, unknown>)) {
      const bad =
        (typeof value === "number" && !Number.isFinite(value)) ||
        (Array.isArray(value) && value.some((x) => typeof x === "number" && !Number.isFinite(x)));
      if (bad) {
        const id = world.index.all()[i]?.id ?? String(i);
        out.push(v("format", id, t, `${id}의 ${key}가 유한한 수가 아니에요 (${String(value)})`));
      }
    }
  }
  return out;
}

const inRange = (x: number, lo: number, hi: number): boolean => x >= lo - REL && x <= hi + REL;

type Reading = readonly [what: string, x: number, lo: number, hi: number];

/** The ranged values one entity state carries, as [name, value, low, high]. */
function readingsOf(s: EntityState): Reading[] {
  const T = [TEMP_MIN_C, TEMP_MAX_C] as const;
  switch (s.kind) {
    case "room":
      return [["방 온도", s.ambientC, ...T]];
    case "rack":
      return [["흡기 온도", s.inletC, ...T]];
    case "server":
      return s.perf === undefined
        ? [["칩 온도", s.cpuC, ...T]]
        : [
            ["칩 온도", s.cpuC, ...T],
            ["성능", s.perf, 0, 1],
          ];
    case "ups":
      return [["배터리", s.batteryPct, 0, 100]];
    case "bbu":
      return [["충전량", s.chargePct, 0, 100]];
    default:
      return [];
  }
}

/** Temperatures, charge and performance stay in the ranges of the contract. */
export function rangeViolations(world: World): Violation[] {
  const out: Violation[] = [];
  const t = world.time();
  for (const e of world.index.all()) {
    for (const [what, x, lo, hi] of readingsOf(world.stateOf(e.id) as EntityState))
      if (!inRange(x, lo, hi))
        out.push(v("range", e.id, t, `${e.id}의 ${what}(${x})가 ${lo}~${hi} 밖이에요`));
  }
  return out;
}

/** The energy balance of each room step, what the cooling units removed, and "cooling off, the room does not cool". */
export function roomViolations(steps: readonly RoomStep[], t: number): Violation[] {
  const out: Violation[] = [];
  for (const s of steps) {
    const flows = Math.abs(s.inW) + Math.abs(s.removedW) + Math.abs(s.envelopeW);
    if (s.removedW > s.capacityW * (1 + REL) + 1e-6)
      out.push(
        v(
          "energy.cooling",
          s.room,
          t,
          `${s.room}: 냉방이 뺀 열 ${s.removedW.toFixed(0)} W가 능력 ${s.capacityW.toFixed(0)} W를 넘어요`,
        ),
      );
    if (s.inW < -1e-6)
      out.push(
        v(
          "energy.room",
          s.room,
          t,
          `${s.room}: 방으로 들어온 열이 음수예요 (${s.inW.toFixed(0)} W)`,
        ),
      );
    if (s.clamped) continue;
    const stored = (s.toC - s.fromC) * s.massJPerK;
    const moved = (s.inW - s.removedW - s.envelopeW) * s.dt;
    if (Math.abs(stored - moved) > REL * (flows * s.dt + Math.abs(stored)) + 1e-6)
      out.push(
        v(
          "energy.room",
          s.room,
          t,
          `${s.room}: 온도 변화 × 열용량(${stored.toFixed(0)} J)이 (들어온 − 뺀 − 벽 손실) × 시간(${moved.toFixed(0)} J)과 달라요`,
        ),
      );
    if (s.removedW === 0 && s.inW >= s.envelopeW && s.toC < s.fromC - REL)
      out.push(
        v(
          "direction.cooling",
          s.room,
          t,
          `${s.room}: 냉방이 꺼져 있는데 방이 식었어요 (${s.fromC.toFixed(3)} → ${s.toC.toFixed(3)} °C)`,
        ),
      );
  }
  return out;
}

export interface BatteryWas {
  readonly pct: number;
  readonly loadW: number;
}

/** A UPS battery gives no more than the load took, and is not charged while it carries the load. */
export function upsViolations(world: World, id: string, was: BatteryWas, dt: number): Violation[] {
  const s = world.stateAs(id, "ups");
  const model = world.catalog.getOf(world.index.find(id)?.modelId ?? "", "ups");
  const factor = faultParam(world.faultsOn(id), "ups_battery_degraded", "factor") ?? 1;
  const capJ = model.batteryKwh * 1000 * 3600 * factor;
  const drawnJ = ((was.pct - s.batteryPct) / 100) * capJ;
  const out: Violation[] = [];
  const t = world.time();
  const most = Math.max(was.loadW, s.loadW) * dt;
  if (drawnJ > most * (1 + REL) + 1e-6)
    out.push(
      v(
        "energy.battery",
        id,
        t,
        `${id}: 배터리가 ${drawnJ.toFixed(0)} J를 내놨는데 부하가 가져간 건 ${most.toFixed(0)} J예요`,
      ),
    );
  if (!s.inputOk && s.batteryPct > was.pct + REL)
    out.push(v("energy.battery", id, t, `${id}: 배터리로 버티는 중인데 충전량이 늘었어요`));
  return out;
}

/** A rack battery likewise. */
export function bbuViolations(world: World, id: string, was: BatteryWas, dt: number): Violation[] {
  const s = world.stateAs(id, "bbu");
  const out: Violation[] = [];
  if (s.onBattery && s.chargePct > was.pct + REL)
    out.push(
      v("energy.battery", id, world.time(), `${id}: 배터리로 버티는 중인데 충전량이 늘었어요`),
    );
  const kwh = world.index.find(id)?.props.kwh;
  const capKwh = typeof kwh === "number" ? kwh : 4;
  const drawnKwh = ((was.pct - s.chargePct) / 100) * capKwh;
  const rackId = world.index.outgoing(id, "member_of")[0]?.to;
  const loadKw = rackId ? world.stateAs(rackId, "rack").powerW / 1000 : 0;
  if (drawnKwh > Math.max(was.loadW / 1000, loadKw) * (dt / 3600) * (1 + REL) + 1e-9)
    out.push(
      v("energy.battery", id, world.time(), `${id}: 배터리가 부하보다 많은 에너지를 내놨어요`),
    );
  return out;
}

/** A device draws between its idle and its maximum while it runs, and nothing while it does not. */
export function deviceViolations(world: World): Violation[] {
  const out: Violation[] = [];
  const t = world.time();
  for (const e of world.index.ofKind("server")) {
    const s = world.stateAs(e.id, "server");
    const model = world.catalog.getOf(e.modelId ?? "", "server");
    const running = s.powered && s.adminOn;
    const lo = running ? model.idlePowerW : 0;
    const hi = running ? model.maxPowerW : 0;
    if (s.powerW < lo * (1 - REL) - 1e-9 || s.powerW > hi * (1 + REL) + 1e-9)
      out.push(
        v(
          "power.device",
          e.id,
          t,
          `${e.id}: 전력 ${s.powerW.toFixed(1)} W가 ${lo}~${hi} W 밖이에요`,
        ),
      );
  }
  return out;
}

/** What a supplier carries is the sum of what the consumers behind it draw, a UPS paying for its losses. */
export function chainViolations(world: World, tolerance: number): Violation[] {
  const pass = passOf(world);
  const supply = new SupplyResolver(world);
  const { plan } = pass;
  const out: Violation[] = [];
  const loadOf = (i: number): number => {
    const s = pass.states[i] as EntityState;
    return s.kind === "generator" ? s.loadKw * 1000 : "loadW" in s ? s.loadW : 0;
  };
  for (const group of [plan.pdus, plan.panels, plan.upses, plan.generators]) {
    for (const i of group) {
      let expected = 0;
      for (let q = plan.inStart[i] as number; q < (plan.inStart[i + 1] as number); q++) {
        const from = plan.inFrom[q] as number;
        if (!supply.feeds(from, i)) continue;
        const state = pass.states[from] as EntityState;
        const demand = !SUPPLIER_KINDS.has(state.kind)
          ? drawW(world, plan.ents[from]?.id ?? "")
          : state.kind === "ups"
            ? state.loadW / upsEfficiencyAt(world, plan.models[from] as UpsModel, state.loadW)
            : loadOf(from);
        expected += demand / supply.feedCount(from);
      }
      const got = loadOf(i);
      if (Math.abs(got - expected) > tolerance * Math.max(Math.abs(expected), 1000))
        out.push(
          v(
            "power.chain",
            plan.ents[i]?.id ?? String(i),
            world.time(),
            `${plan.ents[i]?.id}: 싣고 있는 부하 ${got.toFixed(0)} W가 아랫단 합 ÷ 효율 ${expected.toFixed(0)} W와 달라요`,
          ),
        );
    }
  }
  return out;
}

const nondecreasing = (xs: readonly number[]): boolean =>
  xs.every((x, i) => i === 0 || x >= (xs[i - 1] as number) - REL);

/** Direction properties sampled over the models of the world and the tables of its profile: more load is not less power, a looser cap is not less speed. */
export function directionViolations(world: World): Violation[] {
  const out: Violation[] = [];
  const t = world.time();
  const models = new Set<string>();
  for (const e of world.index.ofKind("server")) if (e.modelId) models.add(e.modelId);
  const device = world.physics.base("power.device") as SlotValues["power.device"];
  for (const id of models) {
    const model = world.catalog.getOf(id, "server") as ServerModel;
    const watts = Array.from({ length: 21 }, (_, k) => serverDrawW(world, model, k / 20));
    if (!nondecreasing(watts))
      out.push(v("direction.load", id, t, `${id}: 부하가 늘었는데 전력이 줄어드는 구간이 있어요`));
  }
  const perf = Array.from({ length: 21 }, (_, k) => capPerf(world, device, k / 20));
  if (!nondecreasing(perf))
    out.push(v("direction.load", "power.device", t, "캡을 풀었는데 성능이 줄어드는 구간이 있어요"));
  const trip = world.physics.curve("power.protection.tripTimeCurve");
  if (
    trip &&
    !nondecreasing(
      [...Array.from({ length: 40 }, (_, k) => 1 + k * 0.5)].map((r) => -interpolate(trip, r)),
    )
  )
    out.push(
      v(
        "direction.load",
        "power.protection",
        t,
        "과부하가 커졌는데 차단기가 더 오래 버티는 구간이 있어요",
      ),
    );
  return out;
}

/** A UPS efficiency of 1 or less over its load range, and a compressor that does work: no energy out of nothing. */
export function conversionViolations(world: World): Violation[] {
  const out: Violation[] = [];
  const t = world.time();
  for (const e of world.index.ofKind("ups")) {
    const model = world.catalog.getOf(e.modelId ?? "", "ups") as UpsModel;
    for (let k = 0; k <= 15; k++) {
      const eff = upsEfficiencyAt(world, model, model.capacityKw * 1000 * (k / 10));
      if (!(eff > 0 && eff <= 1))
        out.push(
          v(
            "range",
            e.id,
            t,
            `${e.id}: UPS 효율 ${eff}가 0 초과 1 이하가 아니에요 (부하율 ${k / 10})`,
          ),
        );
    }
  }
  return out;
}
