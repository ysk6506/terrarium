/**
 * What the electrical model knows about a blueprint and that never changes while the blueprint stands:
 * which cable goes where, which model each device is, which VM runs on which server. Physics walks every
 * entity every step; with this laid out as flat arrays by position (`index.all()` order) a step is plain
 * array reads instead of thousands of id lookups. The plan belongs to the shared, immutable blueprint
 * index, so every world on a thread built from the same blueprint uses the same one.
 */
import {
  type Catalog,
  type EquipmentModel,
  type PanelModel,
  type PduModel,
  panelCapacityW,
} from "@terrarium/core/catalog";
import { type BlueprintIndex, type BulkLoad, bulkOf, type Entity } from "@terrarium/core/world";

/** Which update an entity gets in `updateDevices` (0: none). */
export const SLOT = {
  none: 0,
  server: 1,
  rack: 2,
  switch: 3,
  storage: 4,
  cooling: 5,
  ups: 6,
  plantFeed: 7,
  distribution: 8,
} as const;

const SLOT_OF: Partial<Record<Entity["kind"], number>> = {
  server: SLOT.server,
  rack: SLOT.rack,
  switch: SLOT.switch,
  storage: SLOT.storage,
  cooling_unit: SLOT.cooling,
  ups: SLOT.ups,
  cdu: SLOT.plantFeed,
  chiller: SLOT.plantFeed,
  pdu: SLOT.distribution,
  power_panel: SLOT.distribution,
};

/** The kinds that carry other devices' load. */
export const SUPPLIER_KINDS: ReadonlySet<string> = new Set([
  "pdu",
  "power_panel",
  "ups",
  "generator",
]);

export interface PowerPlan {
  readonly catalog: Catalog;
  readonly ents: readonly Entity[];
  /** Power cables out of entity i are `outTo[outStart[i] .. outStart[i + 1]]`, in cable order. */
  readonly outStart: Int32Array;
  readonly outTo: Int32Array;
  /** Per cable: the supplier it goes to is a generator. */
  readonly toGenerator: Uint8Array;
  /** Power cables into entity i come from `inFrom[inStart[i] .. inStart[i + 1]]`, in cable order. */
  readonly inStart: Int32Array;
  readonly inFrom: Int32Array;
  /** For each cable into an entity (aligned with `inFrom`): its index among the out-cables (`outTo`). */
  readonly inCable: Int32Array;
  /** 1 for a power panel that is a transfer switch. */
  readonly ats: Uint8Array;
  /** The update each entity gets, and the entities that get one (ascending). */
  readonly slot: Uint8Array;
  readonly active: Int32Array;
  /** Model of each device the electrical model draws numbers from (undefined for the rest). */
  readonly models: ReadonlyArray<EquipmentModel | undefined>;
  /** The load a light rack stands for. */
  readonly light: ReadonlyArray<BulkLoad | undefined>;
  readonly servers: Int32Array;
  readonly vms: Int32Array;
  /** For a server, the VMs on it: `vmOn[vmStart[i] .. vmStart[i + 1]]`; for a VM, its host (-1: none). */
  readonly vmStart: Int32Array;
  readonly vmOn: Int32Array;
  readonly vmHost: Int32Array;
  readonly vcpus: Float64Array;
  readonly cores: Float64Array;
  /** What each breaker-protected supplier can carry, W. */
  readonly capacity: Float64Array;
  readonly pdus: Int32Array;
  readonly panels: Int32Array;
  readonly upses: Int32Array;
  readonly generators: Int32Array;
}

const plans = new WeakMap<BlueprintIndex, PowerPlan>();

/** The plan for a blueprint index under a catalog (built once, then shared). */
export function powerPlanOf(index: BlueprintIndex, catalog: Catalog): PowerPlan {
  const known = plans.get(index);
  if (known && known.catalog === catalog) return known;
  const plan = buildPlan(index, catalog);
  plans.set(index, plan);
  return plan;
}

const MODELLED = new Set([
  "server",
  "switch",
  "storage",
  "cooling_unit",
  "ups",
  "pdu",
  "power_panel",
  "cdu",
  "chiller",
]);

function modelOf(entity: Entity, catalog: Catalog, light: BulkLoad | undefined) {
  if (entity.kind === "rack") return light ? catalog.getOf(light.modelId, "server") : undefined;
  if (!MODELLED.has(entity.kind)) return undefined;
  return catalog.getOf(entity.modelId ?? "", entity.kind as "server");
}

interface Csr {
  readonly start: Int32Array;
  readonly to: Int32Array;
}

/** Cables of one kind as flat arrays: for each entity, the positions at the far end, in cable order. */
function cables(
  index: BlueprintIndex,
  ents: readonly Entity[],
  kind: "power" | "runs_on",
  up: boolean,
): Csr {
  const lists = ents.map((e) => (up ? index.incoming(e.id, kind) : index.outgoing(e.id, kind)));
  const start = new Int32Array(ents.length + 1);
  lists.forEach((list, i) => {
    start[i + 1] = (start[i] as number) + list.length;
  });
  const to = new Int32Array(start[ents.length] as number);
  lists.forEach((list, i) => {
    list.forEach((link, k) => {
      to[(start[i] as number) + k] = index.positionOf(up ? link.from : link.to) ?? -1;
    });
  });
  return { start, to };
}

/** For each power cable into an entity, in `inFrom` order: where it stands among the out-cables. */
function cableIndexes(index: BlueprintIndex, ents: readonly Entity[]): Int32Array {
  const at = new Map<string, number>();
  let p = 0;
  for (const e of ents) for (const link of index.outgoing(e.id, "power")) at.set(link.id, p++);
  return Int32Array.from(
    ents.flatMap((e) => index.incoming(e.id, "power").map((link) => at.get(link.id) ?? -1)),
  );
}

const positionsOf = (ents: readonly Entity[], kind: Entity["kind"]) =>
  Int32Array.from(ents.flatMap((e, i) => (e.kind === kind ? [i] : [])));

function capacityOf(entity: Entity, model: EquipmentModel | undefined): number {
  if (entity.kind === "pdu") return (model as PduModel).capacityW;
  if (entity.kind === "power_panel") return panelCapacityW(model as PanelModel);
  return 0;
}

function buildPlan(index: BlueprintIndex, catalog: Catalog): PowerPlan {
  const ents = index.all();
  const n = ents.length;
  const out = cables(index, ents, "power", false);
  const into = cables(index, ents, "power", true);
  const runsOn = cables(index, ents, "runs_on", true);
  const hosts = cables(index, ents, "runs_on", false);
  const light = ents.map((e) => bulkOf(e));
  const models = ents.map((e, i) => modelOf(e, catalog, light[i]));
  // A rack that is not a light rack has no electrical update of its own.
  const slot = Uint8Array.from(
    ents.map((e, i) =>
      e.kind === "rack" && !light[i] ? SLOT.none : (SLOT_OF[e.kind] ?? SLOT.none),
    ),
  );
  const vcpus = new Float64Array(n);
  const vmHost = new Int32Array(n).fill(-1);
  const cores = new Float64Array(n);
  ents.forEach((e, i) => {
    if (e.kind === "vm") {
      vcpus[i] = Number(e.props.cpuCount ?? 4);
      vmHost[i] =
        hosts.start[i + 1] === hosts.start[i] ? -1 : (hosts.to[hosts.start[i] as number] as number);
    }
    const m = models[i];
    if (e.kind === "server" && m?.kind === "server") cores[i] = m.cpuSockets * m.coresPerSocket;
  });
  return {
    catalog,
    ents,
    outStart: out.start,
    outTo: out.to,
    toGenerator: Uint8Array.from(out.to, (t) => (ents[t]?.kind === "generator" ? 1 : 0)),
    inStart: into.start,
    inFrom: into.to,
    inCable: cableIndexes(index, ents),
    ats: Uint8Array.from(ents.map((e, i) => atsOf(e, models[i]))),
    slot,
    active: Int32Array.from(Array.from(slot).flatMap((s, i) => (s === SLOT.none ? [] : [i]))),
    models,
    light,
    servers: positionsOf(ents, "server"),
    vms: positionsOf(ents, "vm"),
    vmStart: runsOn.start,
    vmOn: runsOn.to,
    vmHost,
    vcpus,
    cores,
    capacity: Float64Array.from(ents.map((e, i) => capacityOf(e, models[i]))),
    pdus: positionsOf(ents, "pdu"),
    panels: positionsOf(ents, "power_panel"),
    upses: positionsOf(ents, "ups"),
    generators: positionsOf(ents, "generator"),
  };
}

const atsOf = (entity: Entity, model: EquipmentModel | undefined): number =>
  entity.kind === "power_panel" && model?.kind === "power_panel" && model.style === "ats" ? 1 : 0;
