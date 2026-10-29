/**
 * The builder's running totals, tycoon-style: what the level costs, how much heat and power it asks for
 * against what its cooling and power can give, and plain-language warnings when they do not match.
 */
import type { Catalog, EquipmentModel } from "@terrarium/core/catalog";
import { type BlueprintIndex, type Entity, isRackMountedKind } from "@terrarium/core/world";
import type { Level } from "./levels";

export interface LevelStats {
  readonly costM: number;
  readonly racks: number;
  readonly servers: number;
  /** Nameplate maximum of the IT equipment (W). */
  readonly itMaxW: number;
  /** What it typically draws, at the utilisation worlds start with (W). */
  readonly itTypicalW: number;
  readonly coolingKw: number;
  readonly pduW: number;
  readonly warnings: readonly string[];
}

/** Utilisation a fresh world runs at; matches worldgen's sizing. */
export const TYPICAL_UTIL = 0.6;

function modelOf(catalog: Catalog, e: Entity): EquipmentModel | undefined {
  return e.modelId && catalog.has(e.modelId) ? catalog.get(e.modelId) : undefined;
}

function draw(model: EquipmentModel | undefined, util: number): { max: number; typical: number } {
  if (!model) return { max: 0, typical: 0 };
  if ("maxPowerW" in model)
    return {
      max: model.maxPowerW,
      typical: model.idlePowerW + (model.maxPowerW - model.idlePowerW) * util,
    };
  if ("powerW" in model) return { max: model.powerW, typical: model.powerW };
  return { max: 0, typical: 0 };
}

/** Everything a level contains, however deep. */
function scope(index: BlueprintIndex, level: Level): readonly Entity[] {
  if (level.kind === "site") return index.all();
  return index.descendants(level.id);
}

interface Totals {
  costM: number;
  itMaxW: number;
  itTypicalW: number;
  coolingKw: number;
  pduW: number;
}

function totalsOf(all: readonly Entity[], catalog: Catalog): Totals {
  const t: Totals = { costM: 0, itMaxW: 0, itTypicalW: 0, coolingKw: 0, pduW: 0 };
  for (const e of all) {
    const model = modelOf(catalog, e);
    t.costM += model?.costM ?? 0;
    if (isRackMountedKind(e.kind) && e.kind !== "pdu") {
      const d = draw(model, TYPICAL_UTIL);
      t.itMaxW += d.max;
      t.itTypicalW += d.typical;
    }
    if (model?.kind === "cooling_unit") t.coolingKw += model.capacityKw;
    if (model?.kind === "pdu") t.pduW += model.capacityW;
  }
  return t;
}

function coolingWarning(itTypicalW: number, coolingKw: number): string | undefined {
  const heatKw = itTypicalW / 1000;
  if (itTypicalW > 0 && coolingKw === 0) return "냉방기가 없어 장비의 열을 식힐 수 없다";
  if (heatKw > coolingKw)
    return `평소 발열(${heatKw.toFixed(1)} kW)이 냉방 용량(${coolingKw} kW)보다 크다`;
  if (coolingKw > 0 && heatKw > coolingKw * 0.8)
    return "냉방 용량의 80%를 넘게 쓴다. 냉방기 하나가 멈추면 버티지 못한다";
  return undefined;
}

function wiringWarnings(
  index: BlueprintIndex,
  all: readonly Entity[],
  coolingKw: number,
): string[] {
  const out: string[] = [];
  const unpowered = all.filter(
    (e) =>
      isRackMountedKind(e.kind) && e.kind !== "pdu" && index.outgoing(e.id, "power").length === 0,
  ).length;
  if (unpowered > 0) out.push(`전원에 연결되지 않은 장비가 ${unpowered}대 있다`);
  const uncooled = all.filter(
    (e) => e.kind === "rack" && index.outgoing(e.id, "cooling").length === 0,
  ).length;
  if (uncooled > 0 && coolingKw > 0) out.push(`냉방기에 연결되지 않은 랙이 ${uncooled}개 있다`);
  return out;
}

export function levelStats(index: BlueprintIndex, catalog: Catalog, level: Level): LevelStats {
  const all = scope(index, level);
  const t = totalsOf(all, catalog);
  const cooling = coolingWarning(t.itTypicalW, t.coolingKw);
  return {
    ...t,
    racks: all.filter((e) => e.kind === "rack").length,
    servers: all.filter((e) => e.kind === "server").length,
    warnings: [...(cooling ? [cooling] : []), ...wiringWarnings(index, all, t.coolingKw)],
  };
}
