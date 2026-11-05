/** Alarms for the plant and the liquid side of the halls (REQ-044); same conventions as alarms.ts. */
import type { CduModel, ChillerModel, PanelModel } from "@terrarium/core/catalog";
import type { Entity, Fault, StateOf, World } from "@terrarium/core/world";
import { type Draft, type Hit, NO_HITS, pushHits, type Scan } from "./alarm-scan";
import { leakIsolated } from "./plant";
import { hasFault } from "./power-supply";

/** Bath above this is too warm for the hardware warranty; above the critical level servers throttle. */
export const BATH_WARNING_C = 45;
export const BATH_CRITICAL_C = 55;
export const FUEL_LOW_PCT = 25;

function cduHits(s: StateOf<"cdu">, model: CduModel, entity: Entity): Hit[] {
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

function chillerHits(s: StateOf<"chiller">, model: ChillerModel, entity: Entity): Hit[] {
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

function generatorHits(s: StateOf<"generator">, entity: Entity): Hit[] {
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

function liquidRackHits(
  world: World,
  s: StateOf<"rack">,
  faults: readonly Fault[],
  entity: Entity,
): readonly Hit[] {
  if (!(s.bathC > BATH_WARNING_C) && !hasFault(faults, "coolant_leak")) return NO_HITS;
  const hits: Hit[] = [];
  if (hasFault(faults, "coolant_leak"))
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

function feedHits(s: StateOf<"power_panel">, model: PanelModel, entity: Entity): readonly Hit[] {
  const main =
    model.style === "transformer" || model.style === "switchgear" || model.style === "ats";
  return main && !s.powered && !s.tripped
    ? [["feed_lost", "critical", `${entity.name} 전원 상실`]]
    : NO_HITS;
}

/** Alarms for an entity of the plant or the liquid side (nothing for any other kind). */
export function plantAlarms(scan: Scan, i: number, entity: Entity, out: Draft[]): void {
  const s = scan.states[i];
  const model = scan.plan.models[i];
  let hits: readonly Hit[] = NO_HITS;
  if (s?.kind === "cdu") hits = cduHits(s, model as CduModel, entity);
  else if (s?.kind === "chiller")
    hits = chillerHits(s, scan.world.catalog.getOf(entity.modelId ?? "", "chiller"), entity);
  else if (s?.kind === "generator") hits = generatorHits(s, entity);
  else if (s?.kind === "rack")
    hits = liquidRackHits(scan.world, s, scan.faults[i] as readonly Fault[], entity);
  else if (s?.kind === "power_panel") hits = feedHits(s, model as PanelModel, entity);
  pushHits(out, entity, hits);
}
