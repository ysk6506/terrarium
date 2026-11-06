/**
 * generateCampus (REQ-043..047): a deterministic multi-building campus on a site's real shape. Each
 * building has a ground floor with the electrical rooms, battery rooms, network room and (in the
 * first) the control room, and floors of data halls that differ in size, cooling, containment and
 * makers. Data-centre buildings hold halls only; a fab holds a few small server rooms among cleanroom
 * bays as big as the building. Same spec and seed, same world.
 */
import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError, SeededRng } from "@terrarium/core/kernel";
import { type AssemblyResult, BlueprintAssembler } from "@terrarium/core/sources";
import type { ReservedPlot } from "@terrarium/core/spatial";
import { type EntityKind, landMarket } from "@terrarium/core/world";
import { emitMechanical, emitPlants } from "./campus-cooling";
import { type CrahPlan, draftHall, emitHall, planCrah } from "./campus-hall";
import { emitLockedRooms } from "./campus-locked";
import type { HallContainment } from "./campus-plan";
import {
  type BuildingPlan,
  type CampusPlan,
  type HallMode,
  labLetter,
  planCampus,
} from "./campus-plan";
import { emitPower } from "./campus-power";
import {
  type CampusSpec,
  campusProblems,
  MAX_CAMPUS_RACKS,
  MAX_DETAILED_RACKS,
} from "./campus-spec";
import { emitNetworkRoom, emitRoom, roomCooling } from "./campus-support";
import type { CampusCtx, HallDraft } from "./campus-types";
import { withServices } from "./services";
import type { SiteSlot } from "./sites";
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

/**
 * The building itself: a data centre, a fab or a DSR tower. A building on a map's place carries the name
 * the map gives it ("17라인", "V1", "HPC센터"); the others are named after their number.
 */
function addBuilding(ctx: CampusCtx, building: BuildingPlan): void {
  const named = {
    fab: [`FAB${building.index}동`, "fab"],
    lab: [`DSR동 ${labLetter(building.index)}타워`, "research"],
    dc: [`DC${building.index}동`, "data_center"],
  } as const;
  const [name, purpose] = named[building.kind];
  // A building on a map's place has the size of the real one: its size is locked (REQ-076).
  const props: Record<string, string | boolean> = { purpose };
  if (building.slot) props.sizeLocked = true;
  ctx.asm.building(
    building.id,
    ctx.siteId,
    building.slot?.name ?? name,
    props,
    building.slot,
    building.fixed?.size,
  );
}

/** Floors of a building: the ground floor, and one per level above it. */
function addFloors(ctx: CampusCtx, building: BuildingPlan): void {
  ctx.asm.floor(`${building.id}-f1`, building.id, "1F", 1);
  for (const level of building.levels)
    ctx.asm.floor(`${building.id}-f${level}`, building.id, `${level}F`, level);
}

/** The cleanroom bay of every fab floor above the ground: a huge room with the line's tools, none of which the world models. */
function emitBays(ctx: CampusCtx, building: BuildingPlan): void {
  if (!building.bay) return;
  const top = building.levels.at(-1);
  for (const level of building.levels)
    emitRoom(ctx, `${building.id}-f${level}`, {
      id: `${building.id}-f${level}-bay`,
      name: `${level}F 클린룸`,
      purpose: "cleanroom",
      size: level === top && building.topBay ? building.topBay : building.bay,
    });
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

/** The floors that have coolant distribution units, and so a mechanical room already. */
const floorsWithCdus = (cdus: ReadonlyMap<string, readonly string[]>): Set<string> =>
  new Set([...cdus].flatMap(([floor, ids]) => (ids.length > 0 ? [floor] : [])));

function buildBuilding(
  ctx: CampusCtx,
  rng: SeededRng,
  building: BuildingPlan,
  backbone: string[],
): HallDraft[] {
  const { asm, catalog } = ctx;
  addBuilding(ctx, building);
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
  if (building.fixed) emitLockedRooms(ctx, building, floorsWithCdus(cdus));
  const plants = emitPlants(ctx, building.id, drafts, crah, cduIds, cduLoadKw);
  emitPower(ctx, {
    building: building.id,
    halls: drafts,
    crah,
    plants,
    distributed: building.fixed !== undefined,
  });
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
  emitBays(ctx, building);
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

/**
 * Where the map shows a building this campus does not build (it asked for fewer fabs than the map has
 * blue roofs, say), and the other buildings the map shows (offices, plant, substations), which no spec
 * builds. The ground stays clear: nothing is built or laid out over it. The campus draws the other
 * buildings where they stand.
 */
export function unbuiltPlots(preset: SitePreset, spec: CampusSpec): ReservedPlot[] {
  const plot = (kind: ReservedPlot["kind"], s: SiteSlot): ReservedPlot => ({
    kind,
    x: Math.round(s.x - s.w / 2),
    y: Math.round(s.y - s.d / 2),
    w: s.w,
    d: s.d,
  });
  return [
    ...preset.dcs.slice(spec.buildings).map((s) => plot("dc", s)),
    ...preset.fabs.slice(spec.fabs).map((s) => plot("fab", s)),
    ...preset.labs.slice(spec.labs).map((s) => plot("lab", s)),
    ...preset.places.map((s) => plot(s.kind, s)),
  ];
}

export function generateCampus(spec: CampusSpec, catalog: Catalog = new Catalog()): CampusResult {
  const problems = campusProblems(spec);
  if (problems.length > 0)
    throw new InvalidValueError(`세계를 만들 수 없어요: ${problems.join("; ")}`);
  const preset = sitePreset(spec.site) as SitePreset;
  const rng = new SeededRng(spec.seed);
  const plan = planCampus(spec, preset.code, rng.fork("plan"), preset, catalog);
  if (plan.racks > MAX_CAMPUS_RACKS)
    throw new InvalidValueError(
      `세계를 만들 수 없어요: 랙이 ${plan.racks}개예요. 한 캠퍼스는 ${MAX_CAMPUS_RACKS}개까지 만들 수 있어요`,
    );
  if (plan.detailedRacks > MAX_DETAILED_RACKS)
    throw new InvalidValueError(
      `세계를 만들 수 없어요: 서버까지 만드는 랙이 ${plan.detailedRacks}개예요. ${MAX_DETAILED_RACKS}개까지 만들 수 있으니 상세 모델링 비율을 낮춰요`,
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
    {
      preset: preset.id,
      powerCapacityMW: preset.power.mw,
      ...(preset.power.estimated ? { powerCapacityEstimated: true } : {}),
      mapX: preset.map.x,
      mapY: preset.map.y,
      landMarket: preset.id,
      landPriceM: landMarket(preset.id).perM2M,
    },
    true,
    preset.outline,
  );
  asm.reserve(preset.code, unbuiltPlots(preset, spec));
  const placed = new Map(plan.buildings.flatMap((b) => Object.entries(b.fixed?.rooms ?? {})));
  const ctx: CampusCtx = { asm, catalog, spec, siteId: preset.code, code: preset.code, placed };
  const backbone: string[] = [];
  const drafts = plan.buildings.flatMap((b) => buildBuilding(ctx, rng.fork(b.id), b, backbone));
  const built = asm.build();
  const result = { ...built, blueprint: withServices(built.blueprint) };
  const stats: Partial<Record<EntityKind, number>> = {};
  for (const e of result.blueprint.entities) stats[e.kind] = (stats[e.kind] ?? 0) + 1;
  return { ...result, stats, halls: summarize(plan, drafts) };
}

/** What a campus comes to, without building it: the racks exactly, servers and power as round estimates. */
export interface CampusSize {
  readonly racks: number;
  /** Racks built server by server; the rest count their servers. */
  readonly detailedRacks: number;
  /** About this many servers (a generated rack holds a dozen on average). */
  readonly servers: number;
  /** About this much power the servers ask for, MW. */
  readonly mw: number;
}

/** Servers a generated rack holds on average, and the kW it asks for; measured on every site's real mix. */
const SERVERS_PER_RACK = 12;
const KW_PER_RACK = 9;

/** The size of the campus a spec would build, from its plan alone: nothing is assembled, so it answers at once. */
export function campusSize(spec: CampusSpec, catalog: Catalog = new Catalog()): CampusSize {
  const preset = sitePreset(spec.site) as SitePreset;
  const rng = new SeededRng(spec.seed).fork("plan");
  const plan = planCampus(spec, preset.code, rng, preset, catalog);
  return {
    racks: plan.racks,
    detailedRacks: plan.detailedRacks,
    servers: plan.racks * SERVERS_PER_RACK,
    mw: Math.round((plan.racks * KW_PER_RACK) / 100) / 10,
  };
}
