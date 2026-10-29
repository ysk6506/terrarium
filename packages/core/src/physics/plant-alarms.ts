/** Alarms for the plant and the liquid side of the halls (REQ-044); same conventions as alarms.ts. */
import type { Alarm, Entity, World } from "@terrarium/core/world";
import { leakIsolated } from "./plant";

type Draft = Omit<Alarm, "id" | "since">;
type Hit = [code: string, severity: Alarm["severity"], message: string];

/** Bath above this is too warm for the hardware warranty; above the critical level servers throttle. */
export const BATH_WARNING_C = 45;
export const BATH_CRITICAL_C = 55;
export const FUEL_LOW_PCT = 25;

function cduHits(world: World, entity: Entity): Hit[] {
  const s = world.stateAs(entity.id, "cdu");
  const model = world.catalog.getOf(entity.modelId ?? "", "cdu");
  const hits: Hit[] = [];
  if (s.adminOn && !s.running) hits.push(["cdu_stopped", "critical", `${entity.name} 정지`]);
  const failed = s.pumpsOk.filter((ok) => !ok).length;
  if (s.running && failed > 0)
    hits.push([
      "cdu_pump_failed",
      failed >= model.pumps - 1 ? "critical" : "warning",
      `${entity.name} 펌프 ${failed}대 고장`,
    ]);
  if (s.running && s.supplyC > model.maxSupplyC)
    hits.push([
      "cdu_supply_high",
      "critical",
      `${entity.name} 공급 온도 ${s.supplyC.toFixed(1)}°C (한계 ${model.maxSupplyC}°C)`,
    ]);
  else if (s.running && s.supplyC > s.setpointC + 3)
    hits.push([
      "cdu_supply_high",
      "warning",
      `${entity.name} 공급 온도 ${s.supplyC.toFixed(1)}°C (설정 ${s.setpointC}°C)`,
    ]);
  return hits;
}

function chillerHits(world: World, entity: Entity): Hit[] {
  const s = world.stateAs(entity.id, "chiller");
  const model = world.catalog.getOf(entity.modelId ?? "", "chiller");
  const hits: Hit[] = [];
  if (s.adminOn && !s.running) hits.push(["chiller_stopped", "critical", `${entity.name} 정지`]);
  if (s.running && s.loadKw > s.capacityKw)
    hits.push([
      "chiller_overload",
      "warning",
      `${entity.name} 부하 ${Math.round(s.loadKw)}kW (용량 ${Math.round(s.capacityKw)}kW)`,
    ]);
  if (s.supplyC > model.supplySetpointC + 3)
    hits.push([
      "chiller_supply_high",
      "warning",
      `${entity.name} 공급수 ${s.supplyC.toFixed(1)}°C (설정 ${model.supplySetpointC}°C)`,
    ]);
  return hits;
}

function generatorHits(world: World, entity: Entity): Hit[] {
  const s = world.stateAs(entity.id, "generator");
  const hits: Hit[] = [];
  if (s.phase === "running")
    hits.push([
      "generator_running",
      "warning",
      `${entity.name} 운전 중 (부하 ${Math.round(s.loadKw)}kW, 연료 ${Math.round(s.fuelPct)}%)`,
    ]);
  if (s.phase === "starting")
    hits.push(["generator_starting", "warning", `${entity.name} 기동 중`]);
  if (s.phase === "failed") hits.push(["generator_failed", "critical", `${entity.name} 기동 실패`]);
  if (s.fuelPct < FUEL_LOW_PCT)
    hits.push(["generator_fuel_low", "warning", `${entity.name} 연료 ${Math.round(s.fuelPct)}%`]);
  return hits;
}

function liquidRackHits(world: World, entity: Entity): Hit[] {
  const s = world.stateAs(entity.id, "rack");
  const hits: Hit[] = [];
  if (world.faultsOn(entity.id).some((f) => f.type === "coolant_leak"))
    hits.push([
      "coolant_leak",
      "critical",
      leakIsolated(world, entity.id)
        ? `${entity.name} 냉각수 누설 (공급 차단됨)`
        : `${entity.name} 냉각수 누설 감지`,
    ]);
  if (s.bathC > BATH_CRITICAL_C)
    hits.push(["bath_temp_high", "critical", `${entity.name} 액침 유체 ${s.bathC.toFixed(1)}°C`]);
  else if (s.bathC > BATH_WARNING_C)
    hits.push(["bath_temp_high", "warning", `${entity.name} 액침 유체 ${s.bathC.toFixed(1)}°C`]);
  return hits;
}

function feedHits(world: World, entity: Entity): Hit[] {
  const s = world.stateAs(entity.id, "power_panel");
  const model = world.catalog.getOf(entity.modelId ?? "", "power_panel");
  const main =
    model.style === "transformer" || model.style === "switchgear" || model.style === "ats";
  return main && !s.powered && !s.tripped
    ? [["feed_lost", "critical", `${entity.name} 전원 상실`]]
    : [];
}

export function plantAlarms(world: World, entity: Entity): Draft[] {
  let hits: Hit[] = [];
  if (entity.kind === "cdu") hits = cduHits(world, entity);
  else if (entity.kind === "chiller") hits = chillerHits(world, entity);
  else if (entity.kind === "generator") hits = generatorHits(world, entity);
  else if (entity.kind === "rack") hits = liquidRackHits(world, entity);
  else if (entity.kind === "power_panel") hits = feedHits(world, entity);
  return hits.map(([code, severity, message]) => ({
    entityId: entity.id,
    code,
    severity,
    message,
  }));
}
