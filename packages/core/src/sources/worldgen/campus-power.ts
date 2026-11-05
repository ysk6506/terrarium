/**
 * Power chain of a building (REQ-043, REQ-046): utility transformers and diesel generators in the
 * yard, transfer switches (ATS) in the electrical rooms, UPS in the battery rooms, and a switchgear
 * for each power block that feeds the PDUs of the halls. Every stage is sized for the load behind it,
 * so a campus at rest is quiet; the generators are one more than the load needs (N+1).
 */
import { panelCapacityW } from "@terrarium/core/catalog";
import type { EquipmentSpec, YardSpec } from "@terrarium/core/sources";
import type { PlantPower } from "./campus-cooling";
import type { CrahPlan } from "./campus-hall";
import { sidesOf } from "./campus-rack";
import { emitRoom, roomCooling } from "./campus-support";
import { blockId, type CampusCtx, type HallDraft } from "./campus-types";

type Side = "a" | "b";

const ATS_MODEL = "sy-ats-1600a";
const SWITCHGEAR_MODEL = "sy-switchgear-2000a";
const TRANSFORMER_MODEL = "sy-transformer-2500kva";
/** Share of a transfer switch or generator planned to be used, and of a transformer. */
const ATS_SHARE = 0.8;
const GEN_SHARE = 0.8;
const TRANSFORMER_SHARE = 0.7;
/** Headroom on top of the expected load of a block: pumps, lights, growth. */
const HEADROOM = 1.1;
/** A power block up to this load fits the smaller UPS, W. */
const SMALL_UPS_LIMIT_W = 315_000;
const GENERATORS = ["tg-diesel-1mw", "tg-diesel-2mw", "tg-diesel-3mw"] as const;
/** Most generators per side before a bigger model is used. */
const MAX_GENS_PER_SIDE = 3;

export interface PowerInput {
  readonly building: string;
  /** The building has a floor plan (REQ-076): its gear stands in an electrical room on the floor of the halls it feeds. */
  readonly distributed?: boolean;
  readonly halls: readonly HallDraft[];
  readonly crah: ReadonlyMap<string, CrahPlan>;
  /** Plants of the building's cooling loops; they take power from a transfer switch of their own. */
  readonly plants: readonly PlantPower[];
}

interface Block {
  readonly id: string;
  /** The storey of the hall this block feeds. */
  readonly floorId: string;
  readonly model: string;
  /** Load behind the UPS, W. */
  readonly loadW: number;
}

/** What a transfer switch serves: its id and the load it passes to the sources, W. */
interface Feed {
  readonly id: string;
  readonly loadW: number;
}

/** Fill bins in order, opening a new one when an item would overflow; item order decides, so it is stable. */
function pack<T>(items: readonly T[], load: (t: T) => number, cap: number): T[][] {
  const bins: Array<{ items: T[]; used: number }> = [];
  for (const item of items) {
    const w = load(item);
    let bin = bins.find((b) => b.used + w <= cap);
    if (!bin) {
      bin = { items: [], used: 0 };
      bins.push(bin);
    }
    bin.items.push(item);
    bin.used += w;
  }
  return bins.map((b) => b.items);
}

function blocksOf(ctx: CampusCtx, input: PowerInput): Block[] {
  return input.halls.flatMap((hall) => {
    const plan = input.crah.get(hall.plan.id) as CrahPlan;
    const fanW = plan.count * ctx.catalog.getOf(plan.model, "cooling_unit").fanPowerW;
    return Array.from({ length: hall.blocks }, (_, i) => {
      const n = i + 1;
      const itW = hall.pods.filter((p) => p.block === n).reduce((sum, p) => sum + p.loadW, 0);
      const loadW = (itW + fanW / hall.blocks) * HEADROOM;
      return {
        id: blockId(hall, n),
        floorId: hall.plan.floorId,
        loadW,
        model: loadW <= SMALL_UPS_LIMIT_W ? "ups-500kva" : "dp-ups-1200kva",
      };
    });
  });
}

const upstreamW = (ctx: CampusCtx, block: Block) =>
  block.loadW / ctx.catalog.getOf(block.model, "ups").efficiency;

const tagOf = (building: string) => building.split("-").at(-1)?.toUpperCase() ?? building;
const sideLabel = (side: Side) => side.toUpperCase();

interface SideRooms {
  readonly ele: EquipmentSpec[];
  readonly bat: EquipmentSpec[];
  /** Heat the UPS give off at full block load, W. */
  heatW: number;
  /** The storey each piece of gear belongs on (equipment id → floor id), for a building with a floor plan. */
  readonly floorOf: Map<string, string>;
  /** Heat the UPS give off on each storey, W. */
  readonly heatOf: Map<string, number>;
}

/** Switchgear and UPS of every block on one side; links switchgear -> UPS. */
function blockEquipment(ctx: CampusCtx, blocks: readonly Block[], side: Side, rooms: SideRooms) {
  for (const block of blocks) {
    const sw = `${block.id}-sw-${side}`;
    const ups = `${block.id}-ups-${side}`;
    const label = block.id.split("-").slice(-3).join("-").toUpperCase();
    rooms.ele.push({
      id: sw,
      kind: "power_panel",
      name: `SWG-${label}-${sideLabel(side)}`,
      modelId: SWITCHGEAR_MODEL,
    });
    rooms.bat.push({
      id: ups,
      kind: "ups",
      name: `UPS-${label}-${sideLabel(side)}`,
      modelId: block.model,
    });
    ctx.asm.link("power", sw, ups);
    const model = ctx.catalog.getOf(block.model, "ups");
    const heat = block.loadW * (1 / model.efficiency - 1);
    rooms.heatW += heat;
    rooms.floorOf.set(sw, block.floorId).set(ups, block.floorId);
    rooms.heatOf.set(block.floorId, (rooms.heatOf.get(block.floorId) ?? 0) + heat);
  }
}

/** Transfer switches in front of the UPS of a side, as few as the load allows. */
function emitAts(
  ctx: CampusCtx,
  input: { building: string; blocks: readonly Block[]; side: Side; rooms: SideRooms },
): Feed[] {
  const { building, blocks, side, rooms } = input;
  const cap = ATS_SHARE * panelCapacityW(ctx.catalog.getOf(ATS_MODEL, "power_panel"));
  const groups = pack(blocks, (b) => upstreamW(ctx, b), cap);
  return groups.map((group, i) => {
    const id = `${building}-ats-${side}${i + 1}`;
    rooms.ele.push({
      id,
      kind: "power_panel",
      name: `ATS-${tagOf(building)}-${sideLabel(side)}${i + 1}`,
      modelId: ATS_MODEL,
    });
    for (const block of group) ctx.asm.link("power", `${block.id}-ups-${side}`, id);
    rooms.floorOf.set(id, (group[0] as Block).floorId);
    return { id, loadW: group.reduce((sum, b) => sum + upstreamW(ctx, b), 0) };
  });
}

/** Transfer switches for the cooling plants, placed in the yard beside the building. */
function emitPlantAts(
  ctx: CampusCtx,
  input: PowerInput,
  sides: readonly Side[],
): Array<Feed & { side: Side }> {
  const cap = ATS_SHARE * panelCapacityW(ctx.catalog.getOf(ATS_MODEL, "power_panel"));
  const groups = pack(input.plants, (p) => p.kw * 1000, cap);
  return groups.map((group, i) => {
    const side = sides[i % sides.length] as Side;
    const id = `${input.building}-mats${i + 1}`;
    ctx.asm.yardItem(
      ctx.siteId,
      `${tagOf(input.building)} 기계 전원반`,
      {
        id,
        kind: "power_panel",
        name: `ATS-${tagOf(input.building)}-M${i + 1}`,
        modelId: ATS_MODEL,
        props: { side },
      },
      input.building,
    );
    for (const plant of group) ctx.asm.link("power", plant.id, id);
    return { id, side, loadW: group.reduce((sum, p) => sum + p.kw * 1000, 0) };
  });
}

/** The smallest generator model that keeps a side within `MAX_GENS_PER_SIDE` machines. */
function generatorModel(ctx: CampusCtx, feeds: readonly Feed[]): string {
  for (const model of GENERATORS) {
    const cap = GEN_SHARE * ctx.catalog.getOf(model, "generator").capacityKw * 1000;
    if (
      feeds.every((f) => f.loadW <= cap) &&
      pack(feeds, (f) => f.loadW, cap).length <= MAX_GENS_PER_SIDE
    )
      return model;
  }
  return GENERATORS[GENERATORS.length - 1] as string;
}

/** Transformers and generators for one side; every switch gets a transformer, a generator and the spare. */
function emitSources(
  ctx: CampusCtx,
  input: { building: string; side: Side; feeds: readonly Feed[] },
): void {
  const { building, side, feeds } = input;
  const tag = tagOf(building);
  const yardItem = (group: string, spec: YardSpec) =>
    ctx.asm.yardItem(ctx.siteId, `${tag} ${group}`, spec, building);
  const trCap =
    TRANSFORMER_SHARE * panelCapacityW(ctx.catalog.getOf(TRANSFORMER_MODEL, "power_panel"));
  const trGroups = pack(feeds, (f) => f.loadW, trCap);
  trGroups.forEach((group, i) => {
    const id = `${building}-tr-${side}${i + 1}`;
    yardItem("수전·변압기", {
      id,
      kind: "power_panel",
      name: `TR-${tag}-${sideLabel(side)}${i + 1}`,
      modelId: TRANSFORMER_MODEL,
      props: { side },
    });
    for (const feed of group) ctx.asm.link("power", feed.id, id);
  });
  const model = generatorModel(ctx, feeds);
  const cap = GEN_SHARE * ctx.catalog.getOf(model, "generator").capacityKw * 1000;
  const genGroups = pack(feeds, (f) => f.loadW, cap);
  const gens = Array.from(
    { length: genGroups.length + 1 },
    (_, i) => `${building}-gen-${side}${i + 1}`,
  );
  for (const [i, id] of gens.entries())
    yardItem("발전기", {
      id,
      kind: "generator",
      name: `GEN-${tag}-${sideLabel(side)}${i + 1}${i === gens.length - 1 ? "(예비)" : ""}`,
      modelId: model,
      props: { side },
    });
  const spare = gens[gens.length - 1] as string;
  genGroups.forEach((group, i) => {
    for (const feed of group) {
      ctx.asm.link("power", feed.id, gens[i] as string);
      ctx.asm.link("power", feed.id, spare);
    }
  });
}

function emitSideRooms(ctx: CampusCtx, building: string, side: Side, rooms: SideRooms): void {
  const floor = `${building}-f1`;
  const tag = tagOf(building);
  const sw = rooms.ele.filter((e) => e.id.includes("-sw-")).map((e) => e.id);
  const feeds = [sw[0] as string, (sw[1] ?? sw[0]) as string];
  const eleHeat = 2000 + 0.2 * rooms.heatW;
  emitRoom(ctx, floor, {
    id: `${building}-f1-ele-${side}`,
    name: `${tag} 전기실 ${sideLabel(side)}계통`,
    purpose: "electrical",
    equipment: [...rooms.ele, ...roomCooling(ctx, `${building}-f1-ele-${side}`, eleHeat, feeds)],
  });
  emitRoom(ctx, floor, {
    id: `${building}-f1-bat-${side}`,
    name: `${tag} UPS·배터리실 ${sideLabel(side)}계통`,
    purpose: "battery",
    equipment: [
      ...rooms.bat,
      ...roomCooling(ctx, `${building}-f1-bat-${side}`, rooms.heatW * 1.3, feeds),
    ],
  });
}

/**
 * One electrical room on each storey that has halls (REQ-076): the switchgear, transfer switches and UPS of
 * both sides for the halls of that storey, cooled by units of their own.
 */
function emitFloorRooms(ctx: CampusCtx, sides: readonly SideRooms[]): void {
  const floors = new Set(sides.flatMap((r) => [...r.floorOf.values()]));
  for (const floorId of [...floors].sort()) {
    const mine = (e: EquipmentSpec) => sides.some((r) => r.floorOf.get(e.id) === floorId);
    const gear = sides.flatMap((r) => [...r.ele, ...r.bat]).filter(mine);
    const feeds = gear.filter((e) => e.id.includes("-sw-")).map((e) => e.id);
    const heat = sides.reduce((n, r) => n + (r.heatOf.get(floorId) ?? 0), 0);
    const id = `${floorId}-ele`;
    const level = floorId.split("-f").at(-1);
    emitRoom(ctx, floorId, {
      id,
      name: `${level}F 전기실`,
      purpose: "electrical",
      equipment: [
        ...gear,
        ...roomCooling(ctx, id, 2000 + 1.5 * heat, [
          feeds[0] as string,
          (feeds[1] ?? feeds[0]) as string,
        ]),
      ],
    });
  }
}

/** Everything electrical for one building: its blocks' switchgear and UPS, transfer switches, sources. */
export function emitPower(ctx: CampusCtx, input: PowerInput): void {
  const sides = sidesOf(ctx.spec.powerRedundancy);
  const blocks = blocksOf(ctx, input);
  const plantAts = emitPlantAts(ctx, input, sides);
  const made: SideRooms[] = [];
  for (const side of sides) {
    const rooms: SideRooms = { ele: [], bat: [], heatW: 0, floorOf: new Map(), heatOf: new Map() };
    made.push(rooms);
    blockEquipment(ctx, blocks, side, rooms);
    const feeds = [
      ...emitAts(ctx, { building: input.building, blocks, side, rooms }),
      ...plantAts.filter((a) => a.side === side),
    ];
    emitSources(ctx, { building: input.building, side, feeds });
    if (!input.distributed) emitSideRooms(ctx, input.building, side, rooms);
  }
  if (input.distributed) emitFloorRooms(ctx, made);
}
