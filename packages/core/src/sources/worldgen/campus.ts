/**
 * generateCampus (REQ-043..047): a deterministic multi-building data-centre campus on a site's real
 * shape. Each building has a ground floor with the electrical rooms, battery rooms, network room and
 * (in the first) the control room, and floors of data halls that differ in size, cooling, containment
 * and makers. Same spec and seed, same world.
 */
import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError, SeededRng } from "@terrarium/core/kernel";
import { type AssemblyResult, BlueprintAssembler } from "@terrarium/core/sources";
import type { EntityKind } from "@terrarium/core/world";
import { emitMechanical, emitPlants } from "./campus-cooling";
import { type CrahPlan, draftHall, emitHall, planCrah } from "./campus-hall";
import type { HallContainment } from "./campus-plan";
import { type BuildingPlan, type CampusPlan, type HallMode, planCampus } from "./campus-plan";
import { emitPower } from "./campus-power";
import {
  type CampusSpec,
  campusProblems,
  MAX_CAMPUS_RACKS,
  MAX_DETAILED_RACKS,
} from "./campus-spec";
import { emitNetworkRoom, emitRoom, roomCooling } from "./campus-support";
import type { CampusCtx, HallDraft } from "./campus-types";
import { type SitePreset, sitePreset } from "./spec";

export interface HallSummary {
  readonly id: string;
  readonly name: string;
  readonly building: string;
  readonly mode: HallMode;
  readonly containment: HallContainment;
  readonly pods: number;
  readonly racks: number;
  /** Expected IT load, kW. */
  readonly loadKw: number;
}

export interface CampusResult extends AssemblyResult {
  readonly stats: Readonly<Partial<Record<EntityKind, number>>>;
  readonly halls: readonly HallSummary[];
}

const levelOf = (floorId: string) => Number(floorId.split("-f").at(-1));

/** Floors of a building: the ground floor, and one per level that has data halls. */
function addFloors(ctx: CampusCtx, building: BuildingPlan): void {
  ctx.asm.floor(`${building.id}-f1`, building.id, "1F", 1);
  const floors = [...new Set(building.halls.map((h) => h.floorId))];
  for (const id of floors) ctx.asm.floor(id, building.id, `${levelOf(id)}F`, levelOf(id));
}

/** Control room of the first building: cooled and powered like any other room. */
function emitControlRoom(ctx: CampusCtx, building: string, feeds: readonly string[]): void {
  const id = `${building}-f1-noc`;
  emitRoom(ctx, `${building}-f1`, {
    id,
    name: "통합 관제실(NOC)",
    purpose: "noc",
    equipment: roomCooling(ctx, id, 8000, feeds),
    size: { w: 16, d: 10 },
  });
}

function buildBuilding(
  ctx: CampusCtx,
  rng: SeededRng,
  building: BuildingPlan,
  backbone: string[],
): HallDraft[] {
  const { asm, catalog } = ctx;
  asm.building(building.id, ctx.siteId, `DC${building.index}동`, { purpose: "data_center" });
  addFloors(ctx, building);
  const drafts = building.halls.map((h) => draftHall(ctx, h, rng.fork(`draft-${h.id}`)));
  const crah = new Map(drafts.map((d) => [d.plan.id, planCrah(catalog, d)]));
  const cdus = new Map<string, string[]>();
  const cduIds: string[] = [];
  let cduLoadKw = 0;
  for (const floorId of new Set(drafts.map((d) => d.plan.floorId))) {
    const mech = emitMechanical(
      ctx,
      floorId,
      drafts.filter((d) => d.plan.floorId === floorId),
    );
    cdus.set(floorId, mech.cdus);
    cduIds.push(...mech.cdus);
    cduLoadKw += mech.loadKw;
  }
  const plants = emitPlants(ctx, building.id, drafts, crah, cduIds, cduLoadKw);
  emitPower(ctx, { building: building.id, halls: drafts, crah, plants });
  const first = drafts[0] as HallDraft;
  const swA = `${first.plan.id}-b1-sw-a`;
  const swB = ctx.spec.powerRedundancy === "2N" ? `${first.plan.id}-b1-sw-b` : swA;
  const cores = emitNetworkRoom(ctx, `${building.id}-f1`, building.id, { a: swA, b: swB });
  for (const hall of drafts)
    for (const pod of hall.pods)
      for (const spine of pod.spines) for (const core of cores) asm.link("network", spine, core);
  if (backbone.length === 0) {
    backbone.push(...cores);
    emitControlRoom(ctx, building.id, [swA, swB]);
  } else {
    for (const [i, core] of cores.entries())
      asm.link("network", core, backbone[i % backbone.length] as string);
  }
  for (const hall of drafts)
    emitHall(ctx, hall, {
      crah: crah.get(hall.plan.id) as CrahPlan,
      cdus: cdus.get(hall.plan.floorId) ?? [],
    });
  return drafts;
}

function summarize(plan: CampusPlan, drafts: readonly HallDraft[]): HallSummary[] {
  return drafts.map((d) => ({
    id: d.plan.id,
    name: d.plan.name,
    building: plan.buildings[d.plan.building - 1]?.id ?? "",
    mode: d.plan.mode,
    containment: d.plan.containment,
    pods: d.pods.length,
    racks: d.pods.reduce((n, p) => n + p.racks.length, 0),
    loadKw: Math.round(d.loadW / 100) / 10,
  }));
}

export function generateCampus(spec: CampusSpec, catalog: Catalog = new Catalog()): CampusResult {
  const problems = campusProblems(spec);
  if (problems.length > 0)
    throw new InvalidValueError(`세계를 만들 수 없다: ${problems.join("; ")}`);
  const preset = sitePreset(spec.site) as SitePreset;
  const rng = new SeededRng(spec.seed);
  const plan = planCampus(spec, preset.code, rng.fork("plan"));
  if (plan.racks > MAX_CAMPUS_RACKS)
    throw new InvalidValueError(
      `세계를 만들 수 없다: 랙이 ${plan.racks}개다. 한 캠퍼스는 ${MAX_CAMPUS_RACKS}개까지 만들 수 있다`,
    );
  if (plan.detailedRacks > MAX_DETAILED_RACKS)
    throw new InvalidValueError(
      `세계를 만들 수 없다: 서버까지 만드는 랙이 ${plan.detailedRacks}개다. ${MAX_DETAILED_RACKS}개까지 만들 수 있으니 상세 모델링 비율을 낮춘다`,
    );
  const asm = new BlueprintAssembler(
    `${preset.code}-c${spec.seed}`,
    spec.name ?? `${preset.name} 캠퍼스`,
    catalog,
    {
      source: "worldgen",
      generator: "campus",
      site: preset.id,
      seed: spec.seed,
      profile: spec.profile,
    },
  );
  asm.site(
    preset.code,
    preset.name,
    preset.land,
    { preset: preset.id, mapX: preset.map.x, mapY: preset.map.y },
    true,
    preset.outline,
  );
  const ctx: CampusCtx = { asm, catalog, spec, siteId: preset.code, code: preset.code };
  const backbone: string[] = [];
  const drafts = plan.buildings.flatMap((b) => buildBuilding(ctx, rng.fork(b.id), b, backbone));
  const result = asm.build();
  const stats: Partial<Record<EntityKind, number>> = {};
  for (const e of result.blueprint.entities) stats[e.kind] = (stats[e.kind] ?? 0) + 1;
  return { ...result, stats, halls: summarize(plan, drafts) };
}
