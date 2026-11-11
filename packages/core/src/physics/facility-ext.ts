/**
 * The power and cooling ladders move with time (REQ-107, ADR-0130): the substation takes its power from a utility feed through
 * two transformers (a feed that is lost is moved off by itself after ten seconds, or by hand when its automatic transfer does not
 * work; a transformer that is too hot trips); a rack battery (BBU) carries the rack when its feeds are gone; a 48 V bus droops with
 * the load; a rear door passes less water when its valve is stuck; an immersion tank warms when its level is low. A rack with a
 * power limit keeps meters (seconds over the limit, work lost to caps) for the power-capping sheets, and a rack with the leak policy
 * powers its servers off when a coolant leak is sensed. Discrete changes are world events with the cause `cluster` or `physics`.
 */
import { approach, clamp } from "@terrarium/core/kernel";
import type { Entity, StateOf, World, WorldEvent } from "@terrarium/core/world";
import { CLUSTER_CAUSE } from "./db";
import { SupplyResolver } from "./power-supply";

/** Seconds a leak sensor needs to power a rack off with the leak policy. */
export const LEAK_SENSE_S = 5;

const num = (e: Entity, key: string, def: number): number =>
  typeof e.props[key] === "number" ? (e.props[key] as number) : def;

const faultOn = (world: World, id: string, type: string) =>
  world.faultsOn(id).find((f) => f.type === type);

const rackOf = (world: World, e: Entity): Entity | undefined => {
  const id = world.index
    .outgoing(e.id, "member_of")
    .find((l) => world.index.find(l.to)?.kind === "rack")?.to;
  return id ? world.index.find(id) : undefined;
};

// ── substation (before the electrical pass: the PDUs read whether it delivers) ───────────────

const note = (world: World, events: WorldEvent[], text: string, cause: string): void => {
  events.push(world.apply({ type: "note", text }, cause));
};

/** Which utility feeds have voltage, and the automatic move to the other one when the active one is lost. */
function updateFeeds(world: World, sub: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(sub.id, "substation");
  const lost = world.faultsOn(sub.id).filter((f) => f.type === "utility_feed_loss");
  s.feeds = [
    !lost.some((f) => (f.params.feed ?? 1) === 1),
    !lost.some((f) => (f.params.feed ?? 1) === 2),
  ];
  if (s.feeds[s.activeFeed - 1]) {
    delete s.lostSince;
    return;
  }
  const t = world.time();
  s.lostSince ??= t;
  const other = s.activeFeed === 1 ? 2 : 1;
  const manual = lost.some((f) => f.params.manual === 1);
  const transferS = world.physicsAt("power.protection", sub.id).autoTransferS;
  if (manual || !s.feeds[other - 1] || t - s.lostSince < transferS) return;
  s.activeFeed = other;
  delete s.lostSince;
  note(world, events, `${sub.name}: 수전 ${other}번 줄로 자동 전환했어요`, CLUSTER_CAUSE);
}

/** Each transformer warms with the load, trips at 105 °C and comes back below 80 °C unless the fault holds it hot. */
function updateTransformers(world: World, sub: Entity, dt: number, events: WorldEvent[]): void {
  const s = world.stateAs(sub.id, "substation");
  const load = world.index
    .incoming(sub.id, "power")
    .reduce((sum, l) => sum + (world.stateAs(l.from, "power_panel").loadW ?? 0), 0);
  const capW = num(sub, "capacityKw", 2000) * 1000;
  const working = s.transformersOk.filter(Boolean).length;
  s.loadPct = working > 0 ? Math.round((load / (capW * working)) * 100) : 100;
  const P = world.physicsAt("power.conversion", sub.id);
  const guard = world.physicsAt("power.protection", sub.id);
  const hotFault = faultOn(world, sub.id, "transformer_overtemp");
  const hotOne = hotFault ? (hotFault.params.transformer ?? 1) : 0;
  const ok: [boolean, boolean] = [...s.transformersOk];
  const temps: [number, number] = [...s.transformerC];
  for (const n of [0, 1] as const) {
    const target =
      P.transformerBaseC +
      P.transformerRiseC * (s.loadPct / 100) ** 2 +
      (hotOne === n + 1 ? P.transformerHotFaultC : 0);
    temps[n] = approach(temps[n], ok[n] ? target : P.transformerOffC, dt, P.transformerTauS);
    if (ok[n] && temps[n] >= guard.transformerTripC) {
      ok[n] = false;
      note(world, events, `${sub.name}: 변압기 ${n + 1}이(가) 과열로 보호 차단됐어요`, "physics");
    } else if (!ok[n] && temps[n] < guard.transformerResetC && hotOne !== n + 1) ok[n] = true;
  }
  s.transformersOk = ok;
  s.transformerC = temps;
}

function describeSubstation(world: World, sub: Entity): void {
  const s = world.stateAs(sub.id, "substation");
  const onActive = s.feeds[s.activeFeed - 1];
  delete s.why;
  const reasons = [
    ...(!onActive ? [`수전 ${s.activeFeed}번 줄이 끊겼어요`] : []),
    ...(!s.feeds.every(Boolean) && onActive ? ["수전 한 줄이 끊겨 있어요"] : []),
    ...(!s.transformersOk.every(Boolean) ? ["변압기 하나가 차단돼 있어요"] : []),
    ...(s.loadPct > 85 ? [`부하율 ${s.loadPct}%`] : []),
  ];
  const delivering = onActive && s.transformersOk.some(Boolean);
  s.status = !delivering ? "down" : reasons.length > 0 ? "degraded" : "ok";
  if (reasons.length > 0) s.why = reasons.join(" · ");
}

function updateSubstation(world: World, sub: Entity, dt: number, events: WorldEvent[]): void {
  updateFeeds(world, sub, events);
  updateTransformers(world, sub, dt, events);
  describeSubstation(world, sub);
}

export function updateSubstations(world: World, dt: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const sub of world.index.ofKind("substation")) updateSubstation(world, sub, dt, events);
  return events;
}

// ── rack batteries and buses ─────────────────────────────────────────────

function updateBbu(world: World, bbu: Entity, supply: SupplyResolver, dt: number): void {
  const s = world.stateAs(bbu.id, "bbu");
  const rack = rackOf(world, bbu);
  const cells = faultOn(world, bbu.id, "bbu_cell_fault")?.params.cells ?? 0;
  s.cellsFailed = cells;
  const S = world.physicsAt("power.storage", bbu.id);
  const capKwh = Math.max(0.1, num(bbu, "kwh", 4) * (1 - S.bbuCellLossShare * cells));
  const pdus = rack ? world.index.childrenOf(rack.id, "pdu") : [];
  const fed = pdus.some((p) => {
    const at = world.index.positionOf(p.id);
    return at !== undefined && supply.fedAt(at);
  });
  const loadKw = rack ? world.stateAs(rack.id, "rack").powerW / 1000 : 0;
  s.onBattery = !fed;
  s.chargePct = clamp(
    s.chargePct +
      (fed ? (100 * dt) / (S.bbuRechargeMin * 60) : -((loadKw * dt) / 3600 / capKwh) * 100),
    0,
    100,
  );
  s.runtimeMin =
    loadKw > 0 ? Math.round((((s.chargePct / 100) * capKwh * 60) / loadKw) * 10) / 10 : 99;
  delete s.why;
  s.status =
    s.onBattery && s.chargePct <= 0 ? "down" : s.onBattery || cells > 0 ? "degraded" : "ok";
  if (s.onBattery) s.why = `피드가 끊겨 배터리로 버텨요(남은 ${s.runtimeMin}분)`;
  else if (cells > 0) s.why = `셀 ${cells}개가 고장 나 버틸 시간이 짧아요`;
}

function updateBus(world: World, bus: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(bus.id, "dc_bus");
  const rack = rackOf(world, bus);
  const sag = faultOn(world, bus.id, "dc_bus_sag")?.params.sagV ?? 0;
  const p = rack ? world.stateAs(rack.id, "rack").powerW : 0;
  const P = world.physicsAt("power.conversion", bus.id);
  s.voltageV =
    Math.round((P.busNominalV - sag - P.busDroopV * (p / num(bus, "ratedW", 30_000)) ** 2) * 100) /
    100;
  const was = s.status;
  delete s.why;
  s.status = s.voltageV < P.busDownV ? "down" : s.voltageV < P.busDegradedV ? "degraded" : "ok";
  if (s.status !== "ok") s.why = `전압 ${s.voltageV} V(${P.busNominalV} V 기준)`;
  if (s.status === "down" && was !== "down" && rack)
    for (const server of world.index.childrenOf(rack.id, "server"))
      if (world.stateAs(server.id, "server").adminOn)
        events.push(world.apply({ type: "power.set", target: server.id, on: false }, "physics"));
}

// ── cooling parts ──────────────────────────────────────────────────────────

function updateRdhx(world: World, door: Entity): void {
  const s = world.stateAs(door.id, "rdhx");
  const rack = rackOf(world, door);
  const r = rack ? world.stateAs(rack.id, "rack") : undefined;
  const valve = faultOn(world, door.id, "rdhx_valve_stuck")?.params.openPct ?? 100;
  s.valvePct = valve;
  s.waterInC = r && r.coolantC > 0 ? Math.round(r.coolantC * 10) / 10 : 0;
  const flow = (3 * Math.max(valve, 5)) / 100;
  s.waterOutC =
    r && r.coolantC > 0
      ? Math.round((r.coolantC + clamp(r.liquidW / (flow * 4186), 0, 40)) * 10) / 10
      : 0;
  delete s.why;
  s.status = !r || r.coolantC <= 0 ? "down" : valve < 100 ? "degraded" : "ok";
  if (s.status === "down") s.why = "냉각수가 오지 않아요";
  else if (valve < 100) s.why = `밸브가 ${valve}%만 열린 채 굳었어요`;
}

function updateTank(world: World, tank: Entity): void {
  const s = world.stateAs(tank.id, "immersion_tank");
  const rack = rackOf(world, tank);
  const r = rack ? world.stateAs(rack.id, "rack") : undefined;
  s.fluidC = r ? Math.round(r.bathC * 10) / 10 : 0;
  s.pumpOk = rack ? !faultOn(world, rack.id, "immersion_circulation_failure") : true;
  s.levelPct = faultOn(world, tank.id, "fluid_level_low")?.params.levelPct ?? 100;
  delete s.why;
  const hot = s.fluidC > 55;
  s.status = s.fluidC > 80 ? "down" : !s.pumpOk || s.levelPct < 90 || hot ? "degraded" : "ok";
  if (!s.pumpOk) s.why = "순환 펌프가 멈춰 유체가 돌지 않아요";
  else if (s.levelPct < 90) s.why = `유체 수위가 ${s.levelPct}%예요`;
  else if (hot) s.why = `유체 온도 ${s.fluidC} °C`;
}

/** A rack with the leak policy powers its servers off once a coolant leak has been sensed. */
function leakPolicy(world: World, rack: Entity, events: WorldEvent[]): void {
  if (rack.props.leakPolicy !== "poweroff") return;
  const t = world.time();
  const leaking = world
    .faultsOn(rack.id)
    .some((f) => f.type === "coolant_leak" && t - f.since >= LEAK_SENSE_S);
  if (!leaking) return;
  for (const server of world.index.childrenOf(rack.id, "server"))
    if (world.stateAs(server.id, "server").adminOn)
      events.push(world.apply({ type: "power.set", target: server.id, on: false }, "physics"));
}

// ── power-capping meters ─────────────────────────────────────────────────

/** Work lost to caps this step (server-seconds), and the first times a server of the rack throttled or stopped. */
function serverMeters(world: World, rack: Entity, r: StateOf<"rack">): number {
  let lost = 0;
  for (const server of world.index.childrenOf(rack.id, "server")) {
    const sv = world.stateAs(server.id, "server");
    const running = sv.powered && sv.adminOn;
    if (sv.perf !== undefined && running) lost += 1 - sv.perf;
    if (sv.throttled) r.hotAt ??= world.time();
    if (!running) r.stopAt ??= world.time();
  }
  return lost;
}

/** The meters of a rack with a power limit: seconds and times over it, work lost to caps, first hot and first stop. */
function meterRack(world: World, rack: Entity, dt: number): void {
  const limit = rack.props.powerLimitW;
  if (typeof limit !== "number") return;
  const r = world.stateAs(rack.id, "rack");
  const over = r.powerW > limit * 1.001;
  r.overS = (r.overS ?? 0) + (over ? dt : 0);
  r.overCount = (r.overCount ?? 0) + (over && !r.over ? 1 : 0);
  r.over = over;
  r.lossS = (r.lossS ?? 0) + serverMeters(world, rack, r) * dt;
}

/** The power and cooling ladders after the thermal pass of a step. */
export function updateFacility(world: World, dt: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  const idx = world.index;
  if (idx.ofKind("bbu").length > 0) {
    const supply = new SupplyResolver(world);
    for (const bbu of idx.ofKind("bbu")) updateBbu(world, bbu, supply, dt);
  }
  for (const bus of idx.ofKind("dc_bus")) updateBus(world, bus, events);
  for (const door of idx.ofKind("rdhx")) updateRdhx(world, door);
  for (const tank of idx.ofKind("immersion_tank")) updateTank(world, tank);
  for (const rack of idx.ofKind("rack")) {
    leakPolicy(world, rack, events);
    meterRack(world, rack, dt);
  }
  return events;
}
