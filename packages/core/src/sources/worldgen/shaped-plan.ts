/**
 * "서비스부터" (REQ-094, ADR-0107): the spec a person fills in on three screens, and what it comes to. A spec is
 * the services (what must not stop), one choice per layer of the HA ladders, and one number, the servers. The
 * plan counts the rest from them — racks, server rooms, switches, PDUs, cooling units, kW — before anything is
 * built, so the screen can say it and the generator can follow it.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  builtChip,
  type ChipBuild,
  type LayerId,
  type Layers,
  layersProblem,
  type ServiceKind,
  type WorkloadProfile,
} from "@terrarium/core/world";
import { type DenseSpec, denseOf } from "./dense";
import { type SiteId, sitePreset, type WorldgenSpec } from "./spec";

/** A part of a service's card. `tier` is the layer it sits in (0 上, 1 가운데, 2 아래); `role` says what a count adds up to. */
export interface ServicePart {
  readonly label: string;
  readonly count?: number;
  readonly tier?: 0 | 1 | 2;
  readonly role?: "node" | "host" | "switch";
  /** On Kubernetes (REQ-096): the workload this part is, by name; `count` is its replicas. */
  readonly workload?: string;
  /** The workloads this one calls, by name (REQ-100). */
  readonly calls?: readonly string[];
}

/** One thing that can stop and what comes of it. */
export interface StopRow {
  readonly what: string;
  readonly result: string;
  readonly bad?: boolean;
}

/** One way a service stops, and what each hour of it costs. */
export interface HarmTier {
  readonly name: string;
  readonly perHourKrw: number;
}

/**
 * The layers a service chooses for itself (ADR-0108 item 5, ADR-0112): how its nodes stand on hosts, where it keeps
 * its data, how its database and its app are made redundant. The network, the power, the cooling and the site are
 * the building's, one for the whole world, and stay as the world's `layers` say.
 */
export const SERVICE_LAYERS = [
  "compute",
  "storage",
  "database",
  "app",
] as const satisfies readonly LayerId[];
export type ServiceLayerId = (typeof SERVICE_LAYERS)[number];
export type ServiceLayers = Readonly<Record<ServiceLayerId, string>>;

export interface ServiceDraft {
  readonly key: string;
  readonly name: string;
  /** What it gives people, in a sentence. */
  readonly gives: string;
  /** What happens when it stops, in a sentence. */
  readonly stopsText: string;
  readonly kind: ServiceKind;
  /** Nodes it runs: virtual machines, or servers when the compute choice is bare metal. */
  readonly nodes: number;
  /** Hosts those nodes spread over when virtualised. */
  readonly hosts: number;
  readonly switches: number;
  readonly parts: readonly ServicePart[];
  readonly stops: readonly StopRow[];
  readonly harm: readonly HarmTier[];
  readonly workload: WorkloadProfile;
  /** The services this one calls, by key (REQ-100). */
  readonly calls?: readonly string[];
  /** Its own choices when it is not shaped like the world's (the "따로 고르기"); absent: the same shape as `ShapeSpec.layers`. */
  readonly layers?: ServiceLayers;
}

export interface ShapeSpec {
  readonly name: string;
  readonly seed: number;
  readonly site: SiteId;
  /** Servers in the whole world, the service's own included. */
  readonly servers: number;
  /** Build the site as it really is instead of by the number (the quick choice "실측"). */
  readonly real?: boolean;
  readonly layers: Layers;
  readonly services: readonly ServiceDraft[];
}

export const SHAPE_LIMITS = {
  servers: { min: 12, max: 4800 },
  services: { max: 6 },
} as const;

/** Servers a compute rack holds in a generated room (the generator fills each to about this). */
export const SERVERS_PER_RACK = 20;
/** Racks a generated room holds at most (12 rows of 20, the first of each row an infra rack). */
const ROOM_RACKS = 240;
const RACK_KW_HEADROOM = 1.15;

export interface ShapePlan {
  readonly serviceHosts: number;
  readonly spareHosts: number;
  readonly serviceNodes: number;
  readonly computeRacks: number;
  readonly racks: number;
  readonly rooms: number;
  readonly buildings: number;
  readonly leaves: number;
  readonly spines: number;
  readonly switches: number;
  readonly pdus: number;
  readonly coolers: number;
  readonly kw: number;
  readonly perRack: number;
  /** The accelerator layer (REQ-107): GPU servers and GPUs, the racks they stand in, the CDUs and the kW of the GPUs. */
  readonly gpuServers: number;
  readonly gpus: number;
  readonly denseRacks: number;
  readonly cdus: number;
  readonly gpuKw: number;
  /** The dense racks the build asks for, as the generator builds them. */
  readonly dense?: DenseSpec;
  readonly layout: Pick<
    WorldgenSpec,
    "buildings" | "floors" | "roomsPerFloor" | "rows" | "racksPerRow"
  >;
}

/** What the chosen modelled chips ask of the build, merged layer by layer. */
export function buildOf(layers: Layers): ChipBuild {
  const merged: Record<string, unknown> = {};
  for (const layer of Object.keys(layers) as Array<keyof Layers>)
    Object.assign(merged, builtChip(layer, layers[layer]).build);
  return merged as ChipBuild;
}

/** The eight choices a service lives on: the world's, with its own four over them when it chose its own. */
export const layersOf = (world: Layers, draft: Pick<ServiceDraft, "layers">): Layers => ({
  ...world,
  ...draft.layers,
});

/** What the service's choices ask of the build; the building's parts (spines, feeds, cooling, rooms) are the world's. */
export const buildFor = (world: Layers, draft: Pick<ServiceDraft, "layers">): ChipBuild =>
  buildOf(layersOf(world, draft));

/** The counts of a service card, added up from its parts: nodes, hosts and switches. */
export function recount(draft: ServiceDraft): ServiceDraft {
  const sum = (role: NonNullable<ServicePart["role"]>, fallback: number) => {
    const found = draft.parts.filter((p) => p.role === role);
    return found.length > 0 ? found.reduce((n, p) => n + (p.count ?? 1), 0) : fallback;
  };
  return {
    ...draft,
    nodes: Math.max(1, sum("node", draft.nodes)),
    hosts: sum("host", draft.hosts),
    switches: sum("switch", draft.switches),
  };
}

/** Hosts one service needs under the compute choice. */
export function hostsOf(draft: ServiceDraft, build: ChipBuild): number {
  if (build.bare) return Math.max(1, draft.nodes);
  const spread = Math.max(build.app?.regions ?? 1, build.site?.mode === "active" ? 2 : 1);
  const clusters = (build.k8s?.clusters ?? 1) * spread;
  const packed = Math.ceil(draft.nodes / (build.pack ?? 3));
  const own = Math.max(1, Math.min(draft.hosts > 0 ? draft.hosts : packed, draft.nodes));
  // two clusters (or two regions) keep each other up only on hosts of their own
  return own * clusters;
}

const rowsFor = (computeRacksPerRoom: number) => {
  const rows = Math.max(1, Math.ceil(computeRacksPerRoom / 19));
  return { rows, racksPerRow: Math.min(20, Math.ceil(computeRacksPerRoom / rows) + 1) };
};

/** Rooms, floors and buildings: what the site choice asks for, or more when the racks do not fit. */
function placesFor(build: ChipBuild, computeRacks: number) {
  const buildings = build.buildings ?? 1;
  const asked = build.rooms ?? 1;
  const rooms = Math.max(asked, buildings, Math.ceil(computeRacks / (ROOM_RACKS - 12)));
  const perBuilding = Math.ceil(rooms / buildings);
  return {
    rooms: perBuilding * buildings,
    buildings,
    roomsPerFloor: Math.min(4, perBuilding),
    floors: Math.ceil(perBuilding / 4),
  };
}

/** GPU servers, the GPUs in them and the kilowatts they draw (70 % of their nameplate) in a world of this build. */
function gpuFigures(build: ChipBuild, dense: DenseSpec | undefined, catalog: Catalog) {
  const servers = build.accel?.servers ?? 0;
  const model = dense?.gpu && dense.server ? catalog.getOf(dense.server, "server") : undefined;
  return {
    servers,
    kw: model ? Math.round((servers * model.maxPowerW * 0.7) / 1000) : 0,
    gpus: servers * Math.min(build.accel?.gpusPerServer ?? 0, model?.gpus ?? 8),
  };
}

/** CDUs for the liquid racks: planned for 60 % of their capacity, one more than the load needs (at least two). */
const cduCount = (kw: number, catalog: Catalog): number =>
  Math.max(2, Math.ceil((kw * 0.75) / (0.6 * catalog.getOf("aq-cdu-500kw", "cdu").capacityKw)) + 1);

function coolersFor(mode: string, kw: number): number {
  const base = Math.max(1, Math.ceil(kw / (0.8 * 100)));
  return mode === "N" ? base : mode === "N+1" ? base + 1 : base * 2;
}

/** Servers the world needs: the service hosts, spares and the database instances of bare-metal worlds, doubled for a second site. */
function serversFor(spec: ShapeSpec, build: ChipBuild, hosts: number): number {
  // database instances of bare-metal worlds stand on servers of their own (virtualised ones share the service's hosts)
  const ring =
    build.dbx?.kind === "raft" ? build.dbx.nodes + (build.site?.mode === "active" ? 1 : 0) : 0;
  const dbHosts = build.bare ? spec.services.length * (build.database?.instances ?? ring) : 0;
  // a second site holds the same hardware again (cold and hot: all of it, warm: half of it)
  const needed = hosts + dbHosts;
  return Math.max(spec.servers, build.site ? needed * 2 + 2 : needed);
}

export function planShape(spec: ShapeSpec): ShapePlan {
  const build = buildOf(spec.layers);
  const serviceHosts = spec.services.reduce((n, s) => n + hostsOf(s, buildFor(spec.layers, s)), 0);
  const spareHosts = spec.services.reduce(
    (n, s) => n + (buildFor(spec.layers, s).spareHosts ?? 0),
    0,
  );
  const serviceNodes = spec.services.reduce((n, s) => n + s.nodes, 0);
  const servers = serversFor(spec, build, serviceHosts + spareHosts);
  const catalog = defaultCatalog();
  const plainRacks = Math.max(3, Math.ceil(servers / SERVERS_PER_RACK));
  const dense = denseOf(build, plainRacks, catalog);
  // a dense rack is wider and takes two places of a row; one more place for the row that cannot be paired
  const computeRacks = plainRacks + (dense ? 2 * dense.racks + 1 : 0);
  const places = placesFor(build, computeRacks);
  const perRoom = Math.ceil(computeRacks / places.rooms);
  const shape = rowsFor(perRoom);
  const racksPerRoom = shape.rows * shape.racksPerRow;
  const racks = racksPerRoom * places.rooms - (dense?.racks ?? 0);
  const spines = (build.spines ?? 2) * places.rooms;
  const feeds = build.feeds ?? 2;
  const gpu = gpuFigures(build, dense, catalog);
  const kw = Math.round((servers * 0.33 + racks * 0.35 + spines * 0.6 + gpu.kw) * RACK_KW_HEADROOM);
  const cdus = dense?.liquid ? cduCount(kw, catalog) : 0;
  const coolers = coolersFor(build.cooling ?? "N+1", kw);
  return {
    serviceHosts,
    spareHosts,
    serviceNodes,
    computeRacks,
    racks,
    rooms: places.rooms,
    buildings: places.buildings,
    leaves: racks,
    spines,
    switches: racks + spines,
    pdus: racks * feeds,
    coolers,
    kw,
    perRack: Math.round(servers / computeRacks),
    gpuServers: gpu.servers,
    gpus: gpu.gpus,
    denseRacks: dense?.racks ?? 0,
    cdus,
    gpuKw: gpu.kw,
    ...(dense ? { dense } : {}),
    layout: {
      buildings: places.buildings,
      floors: places.floors,
      roomsPerFloor: places.roomsPerFloor,
      rows: shape.rows,
      racksPerRow: shape.racksPerRow,
    },
  };
}

/** The generator's own spec for a plan: the layers that change what worldgen builds. */
export function worldgenSpecOf(spec: ShapeSpec, plan: ShapePlan): WorldgenSpec {
  const build = buildOf(spec.layers);
  const dense = plan.dense;
  return {
    site: spec.site,
    seed: spec.seed,
    name: spec.name,
    ...plan.layout,
    fill: 0.8,
    gpuShare: 0,
    containment: build.containment ? "cold" : "none",
    coolingRedundancy: build.cooling ?? "N+1",
    powerRedundancy: build.feeds === 1 ? "N" : "2N",
    vmsPerHost: build.bare ? 0 : 1,
    ...(dense ? { dense } : {}),
    ...(build.power ? { plant: build.power } : {}),
  };
}

/** What a problem with the spec is, in words, or undefined. */
export function shapeProblem(spec: ShapeSpec): string | undefined {
  const { servers, services } = SHAPE_LIMITS;
  if (spec.services.length === 0) return "서비스를 하나는 골라 주세요";
  if (spec.services.length > services.max) return `서비스는 ${services.max}개까지 담아요`;
  if (!spec.real && (spec.servers < servers.min || spec.servers > servers.max))
    return `서버는 ${servers.min}~${servers.max}대 사이로 정해요`;
  if (!sitePreset(spec.site)) return `알 수 없는 사업장 '${spec.site}'`;
  return spec.services.map((s) => serviceProblem(spec.layers, s)).find(Boolean);
}

/** What is wrong with one service of a spec, in words, or undefined. */
function serviceProblem(world: Layers, s: ServiceDraft): string | undefined {
  if (s.name.trim() === "") return "서비스 이름이 비어 있어요";
  const own = s.layers && layersProblem(layersOf(world, s));
  if (own) return `${s.name}: ${own}`;
  if (s.nodes < 1 || s.nodes > 60) return `${s.name}: 노드는 1~60개 사이여야 해요`;
  return undefined;
}

let catalogOnce: Catalog | undefined;
export const defaultCatalog = (): Catalog => {
  catalogOnce ??= new Catalog();
  return catalogOnce;
};
