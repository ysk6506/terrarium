/**
 * Cooling plant of a campus (REQ-044): CDUs in a mechanical room per data floor, and for each building
 * a chilled-water plant for its air handlers and a condenser plant (cooling towers or dry coolers) for
 * its CDUs. The plants of a loop are the same model, because they share the heat evenly.
 */
import type { EquipmentSpec } from "@terrarium/core/sources";
import type { CrahPlan } from "./campus-hall";
import { emitRoom, roomCooling } from "./campus-support";
import { blockId, type CampusCtx, type HallDraft } from "./campus-types";

/** A plant is planned for this share of its capacity; one spare stands by. */
const PLAN_SHARE = 0.6;

export interface PlantPower {
  readonly id: string;
  /** Electric power at the expected load, kW. */
  readonly kw: number;
}

function cduModel(loadKw: number): string {
  if (loadKw <= 500) return "aq-cdu-500kw";
  return loadKw <= 2400 ? "aq-cdu-1mw" : "aq-cdu-2mw";
}

/** CDUs and their room for one data floor; returns the CDU ids and the heat they carry, kW. */
export function emitMechanical(
  ctx: CampusCtx,
  floorId: string,
  halls: readonly HallDraft[],
): { cdus: string[]; loadKw: number } {
  const loadKw = halls.reduce((n, h) => n + h.liquidW, 0) / 1000;
  if (loadKw <= 0) return { cdus: [], loadKw: 0 };
  const model = cduModel(loadKw);
  const cap = ctx.catalog.getOf(model, "cdu").capacityKw;
  const count = Math.max(2, Math.ceil(loadKw / (PLAN_SHARE * cap)) + 1);
  const room = `${floorId}-mech`;
  const first = halls[0] as HallDraft;
  const feed = (i: number) =>
    `${blockId(first, 1)}-sw-${ctx.spec.powerRedundancy === "2N" && i % 2 === 1 ? "b" : "a"}`;
  const cdus: EquipmentSpec[] = Array.from({ length: count }, (_, i) => {
    const id = `${floorId}-cdu${i + 1}`;
    ctx.asm.link("power", id, feed(i));
    return {
      id,
      kind: "cdu" as const,
      name: `CDU-${floorId.split("-").slice(-2).join("-")}-${i + 1}`,
      modelId: model,
    };
  });
  const cooling = roomCooling(ctx, room, 0.04 * loadKw * 1000, [feed(0), feed(1)]);
  emitRoom(ctx, floorId, {
    id: room,
    name: `${floorId.split("-f").at(-1)}F 기계실`,
    purpose: "mechanical",
    equipment: [...cdus, ...cooling],
  });
  return { cdus: cdus.map((c) => c.id), loadKw };
}

interface LoopPlan {
  readonly model: string;
  readonly count: number;
}

function loopPlan(
  ctx: CampusCtx,
  loadKw: number,
  pick: (kw: number) => string,
): LoopPlan | undefined {
  if (loadKw <= 0) return undefined;
  const model = pick(loadKw);
  const cap = ctx.catalog.getOf(model, "chiller").capacityKw;
  return { model, count: Math.max(2, Math.ceil(loadKw / (PLAN_SHARE * cap)) + 1) };
}

const chilledModel = (kw: number) =>
  kw <= 1500 ? "gl-chiller-screw-1mw" : kw <= 6000 ? "gl-chiller-screw-2mw" : "gl-chiller-ft-3mw";

function condenserModel(halls: readonly HallDraft[]): (kw: number) => string {
  const dry = halls.some((h) => h.plan.mode === "immersion" || h.plan.mode === "hybrid");
  return () => (dry ? "gl-drycooler-2mw" : "gl-tower-4mw");
}

/** Plants for a building, placed beside it; wires every consumer to every plant of its loop. */
export function emitPlants(
  ctx: CampusCtx,
  building: string,
  halls: readonly HallDraft[],
  crah: ReadonlyMap<string, CrahPlan>,
  cdus: readonly string[],
  cduLoadKw: number,
): PlantPower[] {
  const out: PlantPower[] = [];
  const chilledKw =
    halls.reduce((n, h) => n + ((crah.get(h.plan.id) as CrahPlan).chilled ? h.airW : 0), 0) / 1000;
  const loops: Array<[string, string, LoopPlan | undefined, string[]]> = [
    [
      "냉수 플랜트",
      "chw",
      loopPlan(ctx, chilledKw, chilledModel),
      halls.flatMap((h) => {
        const plan = crah.get(h.plan.id) as CrahPlan;
        return plan.chilled
          ? Array.from({ length: plan.count }, (_, i) => `${h.plan.id}-crah${i + 1}`)
          : [];
      }),
    ],
    ["냉각수 플랜트", "cond", loopPlan(ctx, cduLoadKw, condenserModel(halls)), [...cdus]],
  ];
  const tag = building.split("-").at(-1)?.toUpperCase();
  for (const [label, key, plan, consumers] of loops) {
    if (!plan) continue;
    const share = (key === "chw" ? chilledKw : cduLoadKw) / plan.count;
    const model = ctx.catalog.getOf(plan.model, "chiller");
    const ids = Array.from({ length: plan.count }, (_, i) => `${building}-${key}${i + 1}`);
    ids.forEach((id, i) => {
      ctx.asm.yardItem(
        ctx.siteId,
        `${tag} ${label}`,
        {
          id,
          kind: "chiller",
          name: `${tag}-${key === "chw" ? "CH" : model.plant === "cooling_tower" ? "CT" : "DC"}-${i + 1}`,
          modelId: plan.model,
          props: { loop: key },
        },
        building,
      );
      out.push({ id, kw: model.powerPerKw * share + 0.01 * model.capacityKw });
    });
    for (const consumer of consumers)
      for (const plant of ids) ctx.asm.link("cooling", consumer, plant);
  }
  return out;
}
