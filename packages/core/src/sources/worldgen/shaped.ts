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
  buildingOf,
  builtChip,
  type ChipBuild,
  type Entity,
  type LayerId,
  serviceProps,
  workloadProps,
} from "@terrarium/core/world";
import { generateCampus } from "./campus";
import { DEFAULT_CAMPUS, SITE_CAMPUS_MIX } from "./campus-spec";
import { generateWorld } from "./generate";
import { type AppService, layApp } from "./shaped-app";
import { contentsOf, type Laying, layCluster, layPool, link, slugOf } from "./shaped-db";
import { layAccel, layLiquidParts, layRackPower } from "./shaped-gpu";
import { type HostPool, hostPool, nodesOn, pickHosts, vmsOn } from "./shaped-hosts";
import { dependsOn, layK8s } from "./shaped-k8s";
import {
  buildFor,
  buildOf,
  defaultCatalog,
  hostsOf,
  layersOf,
  planShape,
  type ServiceDraft,
  type ShapePlan,
  type ShapeSpec,
  shapeProblem,
  worldgenSpecOf,
} from "./shaped-plan";
import { layOverlay, type PlacedService } from "./shaped-sdn";
import {
  hostsForService,
  layCopies,
  layDbx,
  laySites,
  layVolume,
  planSites,
  type SitePlan,
} from "./shaped-site";

export interface ShapedResult {
  readonly blueprint: Blueprint;
  readonly plan: ShapePlan;
  /** What the built world holds, counted from the blueprint itself. */
  readonly counts: {
    readonly servers: number;
    readonly racks: number;
    /** Of the racks, those at the head of each row that hold the network and the storage, not servers (REQ-111). */
    readonly baseRacks: number;
    readonly rooms: number;
    /** Buildings, and the sites a DR plan names (0 without one). */
    readonly buildings: number;
    readonly sites: number;
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

/** The VMs of every Kubernetes cluster of a service: each cluster on its own share of the hosts, so two do not fall together. */
function clusterNodes(
  into: Laying,
  index: BlueprintIndex,
  draft: ServiceDraft,
  hosts: readonly Entity[],
  clusters: number,
): string[] {
  const per = Math.floor(hosts.length / clusters);
  return Array.from({ length: clusters }, (_, k) =>
    nodesOn(
      into,
      index,
      { ...draft, key: k === 0 ? draft.key : `${draft.key}${"b".repeat(k)}` },
      per > 0 ? hosts.slice(k * per, (k + 1) * per) : hosts,
      false,
    ),
  ).flat();
}

/** The cluster of a service: instances on servers no service uses (in other racks when there are racks to spare). */
function layDatabase(
  into: Laying,
  index: BlueprintIndex,
  ctx: {
    readonly pool: HostPool;
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
  const pool = hostPool(index, catalog);
  const world = buildOf(spec.layers);
  const site = planSites(index, pool, world.site);
  const primaryPool = site?.poolA ?? pool;
  const used = new Set<string>();
  const usedB = new Set<string>();
  const placed: PlacedService[] = [];
  const apps: AppService[] = [];
  const into: Laying = { entities: [], links: [] };
  // the world has one pool; its shape follows the world-wide storage choice and the first service's database
  const first = buildFor(spec.layers, spec.services[0] ?? ({} as never));
  const poolId = layPool(
    into,
    { index, catalog, contents: contentsOf(index) },
    first.pool,
    Boolean(first.database?.sharedDisk),
  );
  if (site) laySites(into, index, site, Boolean(world.dbx));
  for (const draft of spec.services) {
    const one = layService(
      into,
      index,
      { pool: primaryPool, used, site, usedB, poolId },
      spec,
      draft,
    );
    placed.push(one.placed);
    apps.push(one.app);
  }
  layNetworkOverlay(into, index, { pool: primaryPool, used, spec, placed });
  layApp(into, { index }, apps);
  layBuildParts(into, { index, catalog, spec, pool: primaryPool, used });
  return into;
}

interface ServiceCtx {
  readonly pool: HostPool;
  readonly used: Set<string>;
  readonly usedB: Set<string>;
  readonly site: SitePlan | undefined;
  readonly poolId: string | undefined;
}

/** How many copies of a service's nodes the build asks for: one per region, two for an active-active pair. */
const spreadOf = (build: ChipBuild): number =>
  Math.max(build.app?.regions ?? 1, build.site?.mode === "active" ? 2 : 1);

/** An active-active pair runs a cluster of its own at each site. */
const clustersOf = (build: ChipBuild): number =>
  (build.k8s?.clusters ?? 1) * (build.site?.mode === "active" ? 2 : 1);

/** One service: its nodes, its database, and (with a site layer) its copy at the second site. */
function layService(
  into: Laying,
  index: BlueprintIndex,
  ctx: ServiceCtx,
  spec: ShapeSpec,
  draft: ServiceDraft,
): { placed: PlacedService; app: AppService } {
  // each service stands the way its own choices say: the building is the world's, the rest is the service's
  const build = buildFor(spec.layers, draft);
  const storage = build.sharedStorage ? index.ofKind("storage")[0] : undefined;
  const { hosts, active, standby } = hostsForService(
    ctx.site,
    ctx.pool,
    ctx.used,
    hostsOf(draft, build),
    build.spareHosts ?? 0,
  );
  const k8s = build.k8s;
  const lead = active.length > 0 ? active : hosts;
  const clusters = clustersOf(build);
  const nodes = k8s
    ? clusterNodes(into, index, draft, lead, clusters)
    : nodesOn(
        into,
        index,
        { ...draft, nodes: draft.nodes * spreadOf(build) },
        lead,
        Boolean(build.bare),
      );
  const id = addService(into, index, draft, {
    nodes,
    standby: standby.map((h) => h.id),
    on: storage ? [storage.id] : [],
  });
  if (k8s) dependsOn(into, id, layK8s(into, draft, nodes, clusters));
  layDatabase(
    into,
    index,
    { pool: ctx.pool, used: ctx.used, build, poolId: ctx.poolId },
    draft,
    id,
  );
  layDbx(into, index, { site: ctx.site, pool: ctx.pool, used: ctx.used, build }, draft, id);
  if (ctx.site) {
    const svc = {
      draft,
      id,
      nodes,
      hostCount: lead.length,
      bare: Boolean(build.bare),
      hasDb: Boolean(build.database),
    };
    if (build.geo && ctx.poolId && draft.kind === "stateful")
      layVolume(into, ctx.site, { id, name: draft.name }, ctx.poolId);
    layCopies(into, index, ctx.site, svc, ctx.usedB);
  }
  return {
    placed: { id, key: draft.key, name: draft.name, kind: draft.kind, nodes },
    app: {
      id,
      key: draft.key,
      name: draft.name,
      kind: draft.kind,
      nodes,
      calls: draft.calls ?? [],
      build: build.app,
      hosts: lead.map((h) => h.id),
    },
  };
}

/** The accelerator layer, the rack batteries and the liquid parts the world's choices ask for (REQ-107). */
function layBuildParts(
  into: Laying,
  ctx: {
    readonly index: BlueprintIndex;
    readonly catalog: Catalog;
    readonly spec: ShapeSpec;
    readonly pool: HostPool;
    readonly used: Set<string>;
  },
): void {
  const { index, catalog, spec } = ctx;
  const build = buildOf(spec.layers);
  if (build.accel)
    layAccel(into, {
      index,
      catalog,
      build: build.accel,
      fabric: spec.layers.network === "net-ai-fabric" ? "roce" : "ib",
      services: spec.services,
      schedulerHost: build.accel.scheduler ? pickHosts(ctx.pool, 1, ctx.used)[0]?.id : undefined,
    });
  if (build.power?.rackBattery) layRackPower(into, index, catalog);
  if (build.liquid) layLiquidParts(into, index, catalog);
}

/** The overlay and the cloud-native network, if the world's network choice asks for them. */
function layNetworkOverlay(
  into: Laying,
  index: BlueprintIndex,
  ctx: {
    readonly pool: HostPool;
    readonly used: Set<string>;
    readonly spec: ShapeSpec;
    readonly placed: readonly PlacedService[];
  },
): void {
  const overlay = buildOf(ctx.spec.layers).overlay;
  if (!overlay) return;
  const picked = pickHosts(ctx.pool, overlay.controllers, ctx.used);
  const controllerHosts =
    picked.length >= overlay.controllers
      ? picked
      : pickHosts(ctx.pool, overlay.controllers, new Set());
  const firewallHosts = new Map<string, string>();
  for (const svc of ctx.placed) {
    const node = svc.nodes[0];
    if (node) firewallHosts.set(svc.id, node);
  }
  layOverlay(into, { index, build: overlay, controllerHosts, firewallHosts }, ctx.placed);
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

/** Automatic VM placement (REQ-096): the virtualisation clusters of the world move VMs by themselves. */
function withDrs(bp: Blueprint, drs: boolean): Blueprint {
  if (!drs) return bp;
  return {
    ...bp,
    entities: bp.entities.map((e) =>
      e.kind === "cluster" ? { ...e, props: { ...e.props, drs: true } } : e,
    ),
  };
}

/** The servers of a cold DR site are installed and cabled but switched off (REQ-106). */
function withColdSite(bp: Blueprint, cold: boolean): Blueprint {
  if (!cold) return bp;
  const index = new BlueprintIndex(bp);
  const buildings = [...index.ofKind("building")].sort((x, y) => x.id.localeCompare(y.id));
  const second = buildings[1]?.id;
  if (!second) return bp;
  return {
    ...bp,
    entities: bp.entities.map((e) =>
      e.kind === "server" && buildingOf(index, e.id) === second
        ? { ...e, props: { ...e.props, adminOff: true } }
        : e,
    ),
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
    baseRacks: bp.entities.filter((e) => e.kind === "rack" && e.props.infra === true).length,
    rooms: n("room"),
    buildings: n("building"),
    sites: n("dr_site"),
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
  const base = withColdSite(
    withDrs(
      trimSpines(withoutServices(baseOf(spec, plan, catalog)), buildOf(spec.layers).spines ?? 2),
      spec.services.some((s) => buildFor(spec.layers, s).drs),
    ),
    buildOf(spec.layers).site?.mode === "cold",
  );
  const laid = lay(base, spec, catalog);
  const blueprint: Blueprint = {
    ...base,
    name: spec.name,
    entities: [...base.entities, ...laid.entities],
    links: [...base.links, ...laid.links],
    meta: {
      ...base.meta,
      generator: "shaped",
      layers: JSON.stringify(spec.layers),
      ...(spec.services.some((s) => s.layers)
        ? {
            serviceLayers: JSON.stringify(
              Object.fromEntries(spec.services.map((s) => [s.key, layersOf(spec.layers, s)])),
            ),
          }
        : {}),
    },
  };
  const notes = [
    ...Object.entries(spec.layers).flatMap(([layer, id]) => {
      const chip = blueprintChipNote(layer, id);
      return chip ? [chip] : [];
    }),
    ...spec.services.flatMap((s) =>
      Object.entries(s.layers ?? {}).flatMap(([layer, id]) => {
        const chip =
          id === spec.layers[layer as LayerId] ? undefined : blueprintChipNote(layer, id);
        return chip ? [`${s.name}: ${chip}`] : [];
      }),
    ),
  ];
  return { blueprint, plan, counts: countOf(blueprint, plan), notes };
}

function blueprintChipNote(layer: string, id: string): string | undefined {
  const built = builtChip(layer as LayerId, id);
  return built.id === id
    ? undefined
    : `${id}는 아직 흉내 낼 수 없어서 ${built.id} 모양으로 지었어요`;
}
