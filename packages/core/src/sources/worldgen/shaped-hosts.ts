/**
 * Where the services of a "서비스부터" world stand (REQ-094): the servers of the generated rooms grouped room by room and
 * rack by rack, the next unused one (rooms in turn, racks spread out), and the VMs laid on them. Split from shaped.ts so
 * the site layer (REQ-106) can pick hosts from one building at a time.
 */
import type { BlueprintIndex, Entity } from "@terrarium/core/world";
import { type Laying, link, slugOf } from "./shaped-db";
import type { ServiceDraft } from "./shaped-plan";

export type HostPool = Map<string, Map<string, Entity[]>>;

export const roomOf = (index: BlueprintIndex, server: Entity): string =>
  index.find(server.parentId ?? "")?.parentId ?? "";

/** The servers a service may stand on, grouped room by room and rack by rack, in a fixed order. */
export function hostPool(index: BlueprintIndex): HostPool {
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
export function pickHosts(pool: HostPool, count: number, used: Set<string>): Entity[] {
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

/** `count` VMs named `key-1 …` on the hosts in turn, kept in the room's datastore; or the servers themselves when bare. */
export function vmsOn(
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

export function nodesOn(
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

export function splitHosts(
  pool: HostPool,
  used: Set<string>,
  want: number,
  spare: number,
): { hosts: Entity[]; active: Entity[]; standby: Entity[] } {
  const hosts = pickHosts(pool, want + spare, used);
  const active = hosts.slice(0, hosts.length - spare || hosts.length);
  return { hosts, active, standby: hosts.slice(active.length) };
}
