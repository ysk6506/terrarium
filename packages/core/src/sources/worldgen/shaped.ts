/**
 * Builds "서비스부터" worlds (REQ-094, ADR-0107): a generated room set sized by the plan, then the services laid on
 * it the way the chosen ladders say. Hosts of one service stand in different racks (and in different rooms when
 * the site choice has more than one), so the redundancy that was chosen is real in the blueprint: two racks, two
 * feeds. A choice the core cannot imitate (a dotted chip) is built as its nearest modelled neighbour.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import {
  type Blueprint,
  BlueprintIndex,
  type ChipBuild,
  type Entity,
  serviceProps,
  workloadProps,
} from "@terrarium/core/world";
import { generateCampus } from "./campus";
import { DEFAULT_CAMPUS, SITE_CAMPUS_MIX } from "./campus-spec";
import { generateWorld } from "./generate";
import { contentsOf, type Laying, layCluster, layPool, link, slugOf } from "./shaped-db";
import {
  buildOf,
  defaultCatalog,
  hostsOf,
  planShape,
  type ServiceDraft,
  type ShapePlan,
  type ShapeSpec,
  shapeProblem,
  worldgenSpecOf,
} from "./shaped-plan";

export interface ShapedResult {
  readonly blueprint: Blueprint;
  readonly plan: ShapePlan;
  /** What the built world holds, counted from the blueprint itself. */
  readonly counts: {
    readonly servers: number;
    readonly racks: number;
    readonly rooms: number;
    readonly vms: number;
    readonly services: number;
    readonly serviceVms: number;
    readonly serviceHosts: number;
    readonly switches: number;
  };
  readonly notes: readonly string[];
}

const withoutServices = (bp: Blueprint): Blueprint => {
  const gone = new Set(bp.entities.filter((e) => e.kind === "service").map((e) => e.id));
  return {
    ...bp,
    entities: bp.entities.filter((e) => !gone.has(e.id)),
    links: bp.links.filter((l) => !gone.has(l.from)),
  };
};

const roomOf = (index: BlueprintIndex, server: Entity): string =>
  index.find(server.parentId ?? "")?.parentId ?? "";

/** The servers a service may stand on, grouped room by room and rack by rack, in a fixed order. */
function hostPool(index: BlueprintIndex): Map<string, Map<string, Entity[]>> {
  const pool = new Map<string, Map<string, Entity[]>>();
  const servers = index
    .ofKind("server")
    .filter((s) => !(s.modelId ?? "").includes("gpu"))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const s of servers) {
    const room = roomOf(index, s);
    const racks = pool.get(room) ?? new Map<string, Entity[]>();
    const rack = racks.get(s.parentId ?? "") ?? [];
    rack.push(s);
    racks.set(s.parentId ?? "", rack);
    pool.set(room, racks);
  }
  return pool;
}

/** The next unused server: rooms in turn, and inside a room racks spread out, never two in one rack while another is free. */
function pickHosts(
  pool: Map<string, Map<string, Entity[]>>,
  count: number,
  used: Set<string>,
): Entity[] {
  const rooms = [...pool.values()].map((racks) => [...racks.values()]);
  const picked: Entity[] = [];
  const touched = new Set<string>();
  for (let round = 0; picked.length < count && round < count * 4; round++) {
    const racks = rooms[round % rooms.length] as Entity[][];
    const stride = Math.max(1, Math.floor(racks.length / Math.ceil(count / rooms.length)));
    const start = (Math.floor(round / rooms.length) * stride + 1) % racks.length;
    for (let k = 0; k < racks.length; k++) {
      const rack = racks[(start + k) % racks.length] as Entity[];
      const free = rack.find((s) => !used.has(s.id));
      const first = rack[0]?.parentId ?? "";
      if (!free || (touched.has(first) && k < racks.length - 1)) continue;
      used.add(free.id);
      touched.add(first);
      picked.push(free);
      break;
    }
  }
  return picked;
}

function addService(
  into: Laying,
  index: BlueprintIndex,
  draft: ServiceDraft,
  places: {
    readonly nodes: readonly string[];
    readonly standby: readonly string[];
    readonly on: readonly string[];
  },
): string {
  const id = `svc-${slugOf(draft.key) || "x"}`;
  const top = draft.harm.reduce((m, t) => Math.max(m, t.perHourKrw), 0);
  into.entities.push({
    id,
    kind: "service",
    name: draft.name,
    props: {
      ...serviceProps({
        kind: draft.kind,
        process: draft.key,
        ...(draft.kind === "batch" ? { delayHours: 4 } : { perHourKrw: top }),
      }),
      ...workloadProps(draft.workload),
      gives: draft.gives,
      stopsText: draft.stopsText,
      harmTiers: JSON.stringify(draft.harm),
      shaped: true,
    },
  });
  for (const node of places.nodes) link(into, "service_on", id, node, "active");
  for (const node of places.on) link(into, "service_on", id, node, "active");
  for (const node of places.standby) link(into, "service_on", id, node, "standby");
  const host = places.nodes[0];
  const from = host ? hostOfNode(index, host) : undefined;
  for (const l of from ? index.outgoing(from, "network").slice(0, 2) : [])
    link(into, "service_via", id, l.to);
  return id;
}

const hostOfNode = (index: BlueprintIndex, node: string): string | undefined =>
  index.find(node)?.kind === "vm" ? index.outgoing(node, "runs_on")[0]?.to : node;

/** `count` VMs named `key-1 …` on the hosts in turn, kept in the room's datastore; or the servers themselves when bare. */
function vmsOn(
  into: Laying,
  index: BlueprintIndex,
  vm: { readonly key: string; readonly count: number; readonly props: Entity["props"] },
  hosts: readonly Entity[],
  bare: boolean,
): string[] {
  if (bare) return hosts.slice(0, vm.count).map((h) => h.id);
  const stores = index.ofKind("datastore");
  return Array.from({ length: vm.count }, (_, i) => {
    const host = hosts[i % hosts.length] as Entity;
    const id = `${host.id}-${slugOf(vm.key)}-vm${i + 1}`;
    into.entities.push({
      id,
      kind: "vm",
      name: `${vm.key}-${i + 1}`,
      props: { cpuCount: 8, memoryGiB: 32, cpuDemand: 0.25, ...vm.props },
    });
    link(into, "runs_on", id, host.id);
    const room = host.id.replace(/-r\d+-s\d+$/, "");
    const store = stores.find((d) => d.id.startsWith(room)) ?? stores[0];
    if (store) link(into, "stored_on", id, store.id);
    return id;
  });
}

function nodesOn(
  into: Laying,
  index: BlueprintIndex,
  draft: ServiceDraft,
  hosts: readonly Entity[],
  bare: boolean,
): string[] {
  if (bare) return hosts.map((h) => h.id);
  return vmsOn(
    into,
    index,
    { key: draft.key, count: draft.nodes, props: { shaped: true } },
    hosts,
    false,
  );
}

/** The cluster of a service: instances on servers no service uses (in other racks when there are racks to spare). */
function layDatabase(
  into: Laying,
  index: BlueprintIndex,
  ctx: {
    readonly pool: Map<string, Map<string, Entity[]>>;
    readonly used: Set<string>;
    readonly build: ChipBuild;
    readonly poolId: string | undefined;
  },
  draft: ServiceDraft,
  serviceId: string,
): void {
  const db = ctx.build.database;
  if (!db) return;
  const picked = pickHosts(ctx.pool, db.instances, ctx.used);
  const hosts = picked.length > 0 ? picked : pickHosts(ctx.pool, db.instances, new Set());
  if (hosts.length === 0) return;
  const bare = Boolean(ctx.build.bare);
  const hostedOn = vmsOn(
    into,
    index,
    { key: `${draft.key}-db`, count: hosts.length, props: { db: true } },
    hosts,
    bare,
  );
  layCluster(
    into,
    serviceId,
    draft.name,
    { ...db, instances: hosts.length },
    { hostedOn },
    ctx.poolId,
  );
}

function lay(bp: Blueprint, spec: ShapeSpec, catalog: Catalog): Laying {
  const index = new BlueprintIndex(bp);
  const build = buildOf(spec.layers);
  const pool = hostPool(index);
  const used = new Set<string>();
  const into: Laying = { entities: [], links: [] };
  const storage = build.sharedStorage ? index.ofKind("storage")[0] : undefined;
  const poolId = layPool(
    into,
    { index, catalog, contents: contentsOf(index) },
    build.pool,
    Boolean(build.database?.sharedDisk),
  );
  for (const draft of spec.services) {
    const hosts = pickHosts(pool, hostsOf(draft, build) + (build.spareHosts ?? 0), used);
    const active = hosts.slice(0, hosts.length - (build.spareHosts ?? 0) || hosts.length);
    const standby = hosts.slice(active.length);
    const nodes = nodesOn(
      into,
      index,
      draft,
      active.length > 0 ? active : hosts,
      Boolean(build.bare),
    );
    const id = addService(into, index, draft, {
      nodes,
      standby: standby.map((h) => h.id),
      on: storage ? [storage.id] : [],
    });
    layDatabase(into, index, { pool, used, build, poolId }, draft, id);
  }
  return into;
}

/** Spine switches the network choice asks for: a legacy tree keeps one per room. */
function trimSpines(bp: Blueprint, spines: number): Blueprint {
  if (spines >= 2) return bp;
  const gone = new Set(bp.entities.filter((e) => /-spine2$/.test(e.id)).map((e) => e.id));
  return {
    ...bp,
    entities: bp.entities.filter((e) => !gone.has(e.id)),
    links: bp.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)),
  };
}

function baseOf(spec: ShapeSpec, plan: ShapePlan, catalog: Catalog): Blueprint {
  if (spec.real) {
    const campus = {
      ...DEFAULT_CAMPUS,
      ...SITE_CAMPUS_MIX[spec.site],
      site: spec.site,
      seed: spec.seed,
    };
    return generateCampus(campus, catalog).blueprint;
  }
  return generateWorld(worldgenSpecOf(spec, plan), catalog).blueprint;
}

function countOf(bp: Blueprint, plan: ShapePlan): ShapedResult["counts"] {
  const n = (kind: string) => bp.entities.filter((e) => e.kind === kind).length;
  const vmIds = new Set(
    bp.entities.filter((e) => e.kind === "vm" && e.props.shaped === true).map((e) => e.id),
  );
  const serviceHosts = new Set(
    bp.links.filter((l) => l.kind === "runs_on" && vmIds.has(l.from)).map((l) => l.to),
  );
  return {
    servers: n("server"),
    racks: n("rack"),
    rooms: n("room"),
    vms: n("vm"),
    services: n("service"),
    serviceVms: bp.entities.filter((e) => e.kind === "vm" && e.props.shaped === true).length,
    serviceHosts: serviceHosts.size || plan.serviceHosts,
    switches: n("switch"),
  };
}

/** The world a spec comes to. The same spec and seed give the same world. */
export function generateShaped(spec: ShapeSpec, catalog: Catalog = defaultCatalog()): ShapedResult {
  const problem = shapeProblem(spec);
  if (problem) throw new InvalidValueError(`세계를 만들 수 없어요: ${problem}`);
  const plan = planShape(spec);
  const base = trimSpines(
    withoutServices(baseOf(spec, plan, catalog)),
    buildOf(spec.layers).spines ?? 2,
  );
  const laid = lay(base, spec, catalog);
  const blueprint: Blueprint = {
    ...base,
    name: spec.name,
    entities: [...base.entities, ...laid.entities],
    links: [...base.links, ...laid.links],
    meta: { ...base.meta, generator: "shaped", layers: JSON.stringify(spec.layers) },
  };
  const notes = Object.entries(spec.layers).flatMap(([layer, id]) => {
    const chip = blueprintChipNote(layer, id);
    return chip ? [chip] : [];
  });
  return { blueprint, plan, counts: countOf(blueprint, plan), notes };
}

import { builtChip, type LayerId } from "@terrarium/core/world";

function blueprintChipNote(layer: string, id: string): string | undefined {
  const built = builtChip(layer as LayerId, id);
  return built.id === id
    ? undefined
    : `${id}는 아직 흉내 낼 수 없어서 ${built.id} 모양으로 지었어요`;
}
