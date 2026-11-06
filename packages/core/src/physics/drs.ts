/**
 * Automatic VM placement (REQ-096, the "자동 재배치" step of the compute ladder): a virtualisation cluster with `drs`
 * set watches how busy its hosts are, and when one is hot while another is idle it moves a VM off the hot one by
 * itself. It is the cluster software acting, so the move is a world event with the cause `cluster`; the VM is slow
 * while it moves. Defaults: a host at 80% busy or more, and 30 points busier than the idlest host.
 */
import {
  DRS_GAP,
  DRS_HOT_UTIL,
  DRS_MIGRATE_S,
  hostOfVm,
  type StateOf,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";
import { CLUSTER_CAUSE } from "./db";
import { effectiveUtil, vmDemand } from "./power";

interface Member {
  readonly id: string;
  readonly util: number;
}

function membersOf(world: World, clusterId: string): Member[] {
  return world.index
    .incoming(clusterId, "member_of")
    .map((l) => world.index.find(l.from))
    .filter((e) => e?.kind === "server")
    .flatMap((e) => {
      const s = world.stateAs((e as { id: string }).id, "server");
      return s.powered && s.adminOn
        ? [{ id: (e as { id: string }).id, util: effectiveUtil(world, e as never) }]
        : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The running VM on `host` that asks for the most. */
function pickVm(world: World, host: string): string | undefined {
  let best: { id: string; d: number } | undefined;
  for (const vm of world.index.ofKind("vm")) {
    const s = world.stateAs(vm.id, "vm") as StateOf<"vm">;
    if (!s.running || hostOfVm(world, vm.id) !== host) continue;
    if (s.migratingUntil !== undefined && world.time() < s.migratingUntil) continue;
    const d = vmDemand(world, vm.id);
    if (d <= 0) continue;
    if (!best || d > best.d) best = { id: vm.id, d };
  }
  return best?.id;
}

export function updateDrs(world: World): WorldEvent[] {
  const events: WorldEvent[] = [];
  const now = world.time();
  for (const cluster of world.index.ofKind("cluster")) {
    if (cluster.props.drs !== true) continue;
    const members = membersOf(world, cluster.id);
    if (members.length < 2) continue;
    const hot = members.reduce((a, b) => (b.util > a.util ? b : a));
    const idle = members.reduce((a, b) => (b.util < a.util ? b : a));
    if (hot.util < DRS_HOT_UTIL || hot.util - idle.util < DRS_GAP) continue;
    const busyMoving = world.index.ofKind("vm").some((v) => {
      const m = (world.stateAs(v.id, "vm") as StateOf<"vm">).migratingUntil;
      return m !== undefined && now < m;
    });
    if (busyMoving) continue;
    const vm = pickVm(world, hot.id);
    if (!vm) continue;
    events.push(world.apply({ type: "vm.migrate", target: vm, host: idle.id }, CLUSTER_CAUSE));
    (world.stateAs(vm, "vm") as StateOf<"vm">).migratingUntil = now + DRS_MIGRATE_S;
  }
  return events;
}
