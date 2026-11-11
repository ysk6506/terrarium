/**
 * The builder's running totals, tycoon-style: what the level costs, how much heat and power it asks for
 * against what its cooling and power can give, and plain-language warnings when they do not match.
 */
import type { Catalog, EquipmentModel } from "@terrarium/core/catalog";
import {
  type BlueprintIndex,
  type Entity,
  isRackMountedKind,
  structureCostM,
} from "@terrarium/core/world";
import { landCostM } from "./edit-site";
import type { Level } from "./levels";

export interface LevelStats {
  readonly costM: number;
  readonly racks: number;
  /** Racks at the head of a row that hold the network and the storage, not servers (a generated world marks them). */
  readonly baseRacks: number;
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

/** Everything a level contains, however deep, and the floor or room itself, whose walls and fit-out are paid for. */
function scope(index: BlueprintIndex, level: Level): readonly Entity[] {
  if (level.kind === "site") return index.all();
  const self = index.find(level.id);
  return self ? [self, ...index.descendants(level.id)] : index.descendants(level.id);
}

interface Totals {
  costM: number;
  itMaxW: number;
  itTypicalW: number;
  coolingKw: number;
  pduW: number;
}

function totalsOf(index: BlueprintIndex, all: readonly Entity[], catalog: Catalog): Totals {
  const t: Totals = { costM: 0, itMaxW: 0, itTypicalW: 0, coolingKw: 0, pduW: 0 };
  for (const e of all) {
    const model = modelOf(catalog, e);
    t.costM += (model?.costM ?? 0) + structureCostM(index, catalog, e);
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
  if (itTypicalW > 0 && coolingKw === 0) return "냉방기가 없어 장비의 열을 식힐 수 없어요";
  if (heatKw > coolingKw)
    return `평소 발열(${heatKw.toFixed(1)} kW)이 냉방 용량(${coolingKw} kW)보다 커요`;
  if (coolingKw > 0 && heatKw > coolingKw * 0.8)
    return "냉방 용량의 80%를 넘게 써요. 냉방기 하나가 멈추면 버티지 못해요";
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
  if (unpowered > 0) out.push(`전원에 연결되지 않은 장비가 ${unpowered}대 있어요`);
  const uncooled = all.filter(
    (e) => e.kind === "rack" && index.outgoing(e.id, "cooling").length === 0,
  ).length;
  if (uncooled > 0 && coolingKw > 0) out.push(`냉방기에 연결되지 않은 랙이 ${uncooled}개 있어요`);
  return out;
}

export function levelStats(index: BlueprintIndex, catalog: Catalog, level: Level): LevelStats {
  const all = scope(index, level);
  const t = totalsOf(index, all, catalog);
  // Land bought through the builder counts where the whole site is looked at.
  if (level.kind === "site") t.costM += landCostM(index);
  const cooling = coolingWarning(t.itTypicalW, t.coolingKw);
  return {
    ...t,
    racks: all.filter((e) => e.kind === "rack").length,
    baseRacks: all.filter((e) => e.kind === "rack" && e.props.infra === true).length,
    servers: all.filter((e) => e.kind === "server").length,
    warnings: [...(cooling ? [cooling] : []), ...wiringWarnings(index, all, t.coolingKw)],
  };
}

/** What one thing costs with everything inside it: its model, its walls and fit-out, and what stands in it (million won). */
export function costOf(index: BlueprintIndex, catalog: Catalog, entity: Entity): number {
  return totalsOf(index, [entity, ...index.descendants(entity.id)], catalog).costM;
}
