/**
 * The database and storage layers of a "서비스부터" world (REQ-095, ADR-0107 item 6): a storage pool that the chosen
 * storage choice asks for (two controllers behind one array, or nodes holding copies), and for every service a database
 * cluster of the shape the database choice asks for. The instances stand on different servers, which the caller picks
 * in different racks, so the redundancy that was chosen is real in the blueprint: a second rack, a second feed.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  type BlueprintIndex,
  type DatabaseBuild,
  dbClusterProps,
  type Entity,
  heightU,
  type Link,
  type PoolBuild,
  poolProps,
} from "@terrarium/core/world";

export interface Laying {
  readonly entities: Entity[];
  readonly links: Link[];
}

export function link(
  into: Laying,
  kind: Link["kind"],
  from: string,
  to: string,
  role?: string,
): void {
  into.links.push({
    id: `${from}-${kind}-${to}${role ? `-${role}` : ""}`,
    kind,
    from,
    to,
    props: role ? { role } : {},
  });
}

export const slugOf = (text: string) => text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

const STORAGE_MODEL = "stor-2u-24bay";
const TOP_U = 38;

/** What stands in each rack, by rack id (computed once for a world). */
export function contentsOf(index: BlueprintIndex): Map<string, Entity[]> {
  const out = new Map<string, Entity[]>();
  for (const e of index.all()) {
    if (!e.parentId || e.placement?.type !== "unit") continue;
    const list = out.get(e.parentId) ?? [];
    list.push(e);
    out.set(e.parentId, list);
  }
  return out;
}

/** The highest free span of `u` units in a rack (below the top-of-rack switch), or undefined when there is none. */
function freeSpan(rack: readonly Entity[], u: number, catalog: Catalog): number | undefined {
  const taken = new Set<number>();
  for (const e of rack) {
    const at = e.placement?.type === "unit" ? e.placement.u : 0;
    for (let k = 0; k < Math.max(1, heightU(e, catalog)); k++) taken.add(at + k);
  }
  for (let top = TOP_U; top >= 2; top--) {
    if (Array.from({ length: u }, (_, k) => top - k).every((x) => x >= 2 && !taken.has(x)))
      return top - u + 1;
  }
  return undefined;
}

interface Racks {
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  readonly contents: Map<string, Entity[]>;
}

/** A storage node in a rack of its own: powered from the rack's PDUs and cabled to its top-of-rack switch. */
function addNode(into: Laying, racks: Racks, rack: Entity, n: number): string | undefined {
  const here = racks.contents.get(rack.id) ?? [];
  const model = racks.catalog.getOf(STORAGE_MODEL, "storage");
  const at = freeSpan(here, model.uHeight, racks.catalog);
  if (at === undefined) return undefined;
  const id = `${rack.id}-pool${n}`;
  const node: Entity = {
    id,
    kind: "storage",
    name: `${rack.name}-sto${n}`,
    parentId: rack.id,
    modelId: STORAGE_MODEL,
    placement: { type: "unit", u: at },
    props: { pool: true },
  };
  into.entities.push(node);
  here.push(node);
  for (const pdu of here.filter((e) => e.kind === "pdu")) link(into, "power", id, pdu.id);
  const tor = here.find((e) => e.kind === "switch");
  if (tor) link(into, "network", id, tor.id);
  return id;
}

/** The racks of the world, infra racks (the ones that already have an array) first, in a fixed order. */
function rackOrder(racks: Racks): Entity[] {
  const arrays = new Set(racks.index.ofKind("storage").map((s) => s.parentId));
  return [...racks.index.ofKind("rack")]
    .filter((r) =>
      racks.contents.get(r.id)?.some((e) => e.kind === "server" || e.kind === "switch"),
    )
    .sort(
      (a, b) => Number(arrays.has(b.id)) - Number(arrays.has(a.id)) || a.id.localeCompare(b.id),
    );
}

/** At least `count` storage arrays: the world's own, then new ones in racks that have none, one rack each. */
function arraysFor(into: Laying, racks: Racks, count: number): string[] {
  const own = racks.index
    .ofKind("storage")
    .filter((s) => s.props.pool !== true)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => s.id);
  const ids = own.slice(0, count);
  const used = new Set(own.map((id) => racks.index.find(id)?.parentId));
  let n = 1;
  for (const rack of rackOrder(racks)) {
    if (ids.length >= count) break;
    if (used.has(rack.id)) continue;
    const added = addNode(into, racks, rack, n++);
    if (added) {
      ids.push(added);
      used.add(rack.id);
    }
  }
  return ids;
}

/** The pool of the world, or undefined when nothing asked for one. Returns its id. */
export function layPool(
  into: Laying,
  racks: Racks,
  want: PoolBuild | undefined,
  needsShared: boolean,
): string | undefined {
  const build: PoolBuild | undefined = want ?? (needsShared ? { mode: "dual" } : undefined);
  if (!build) return undefined;
  const id = "pool-main";
  if (build.mode === "distributed") {
    const nodes = arraysFor(into, racks, build.nodes ?? 4);
    into.entities.push({
      id,
      kind: "storage_pool",
      name: "분산 스토리지 풀",
      props: poolProps({ mode: "distributed", copies: Math.min(build.copies ?? 3, nodes.length) }),
    });
    for (const n of nodes) link(into, "backed_by", id, n);
    return id;
  }
  const array = arraysFor(into, racks, 1)[0];
  if (!array) return undefined;
  into.entities.push({
    id,
    kind: "storage_pool",
    name: "공유 스토리지 풀",
    props: poolProps({ mode: "dual", multipath: build.multipath ?? false }),
  });
  link(into, "backed_by", id, array);
  for (const c of ["a", "b"]) {
    const ctl = `${id}-ctl-${c}`;
    into.entities.push({
      id: ctl,
      kind: "storage_controller",
      name: `컨트롤러 ${c.toUpperCase()}`,
      props: {},
    });
    link(into, "hosted_on", ctl, array);
    link(into, "member_of", ctl, id);
  }
  return id;
}

const ROLES: Readonly<Record<string, readonly string[]>> = {
  single: ["primary"],
  active_passive: ["primary", "standby"],
  shared_aa: ["primary", "primary", "primary"],
  replicated: ["primary", "secondary"],
  auto_failover: ["primary", "secondary", "secondary"],
};

/** The roles of the instances of a cluster of this shape, as many as it has instances. */
export const rolesOf = (build: DatabaseBuild): string[] =>
  Array.from({ length: build.instances }, (_, i) => {
    const list = ROLES[build.shape] ?? ["primary"];
    return list[Math.min(i, list.length - 1)] as string;
  });

export interface DatabasePlace {
  /** Where each instance stands: the VM it runs on, or the server itself when there are no VMs. */
  readonly hostedOn: readonly string[];
}

/** The cluster of one service and its instances; `placed` says where each instance runs. */
export function layCluster(
  into: Laying,
  serviceId: string,
  name: string,
  build: DatabaseBuild,
  placed: DatabasePlace,
  poolId: string | undefined,
): void {
  const cluster = `${serviceId}-db`;
  into.entities.push({
    id: cluster,
    kind: "db_cluster",
    name: `${name} DB`,
    props: dbClusterProps({
      shape: build.shape,
      failover: build.failover,
      ...(build.detectS ? { detectS: build.detectS } : {}),
      ...(build.quorum ? { quorum: build.quorum } : {}),
    }),
  });
  rolesOf(build).forEach((role, i) => {
    const host = placed.hostedOn[i];
    if (!host) return;
    const id = `${cluster}${i + 1}`;
    into.entities.push({ id, kind: "db_instance", name: `${name} DB ${i + 1}`, props: { role } });
    link(into, "member_of", id, cluster);
    link(into, "hosted_on", id, host);
    if (poolId) link(into, "stored_on", id, poolId);
  });
  link(into, "depends_on", serviceId, cluster);
}
