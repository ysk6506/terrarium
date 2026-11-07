/**
 * How the overlay and the cloud-native layer look to the services that lean on them (REQ-097, ADR-0107 item 6). Like the
 * rest of service health nothing here is simulated: the verdict is read off the state physics keeps (physics/sdn.ts),
 * so putting the state right (a sync, a restart, a reverted policy) brings the service back by itself.
 *
 * The rules, for a service:
 *   - its segment is down                                   stopped (every place of it)
 *   - some of its places sit behind a VTEP cut off          those places are dead (a stateful service stops with one,
 *                                                           the others only when none is left)
 *   - the CNI plugin of a place's node is down              that place is dead the same way
 *   - the ingress is down                                   a request service stops (users cannot come in), others slow
 *                                                           (calls from inside the cluster still work)
 *   - a virtual function in its way is overloaded           slow (latency)
 *   - a network policy denies it, or a service it calls   it is slow; the policy walks the `calls` links, so every
 *                                                           caller of the guarded service is slow (REQ-100)
 * A controller that is down changes nothing here: what is configured keeps flowing (headless), only new configuration
 * cannot be pushed.
 */
import { callsOut } from "./app";
import type { Entity } from "./blueprint";
import {
  cniOfHost,
  leafOfServer,
  policiesOf,
  sdnDependencies,
  serverUnder,
  vtepOfSwitch,
} from "./sdn";
import type { ServiceDef, ServiceStatus } from "./service";
import type { WorldReader } from "./world";

export interface SdnVerdict {
  readonly status: ServiceStatus;
  readonly reasons: readonly string[];
}

const RANK: Readonly<Record<ServiceStatus, number>> = { healthy: 0, degraded: 1, down: 2 };
const worse = (a: ServiceStatus, b: ServiceStatus): ServiceStatus => (RANK[a] >= RANK[b] ? a : b);

/** Why the node a place stands on is cut off from the overlay of `segment`, or undefined. */
function cutReason(
  world: WorldReader,
  hostId: string,
  segment: Entity | undefined,
): string | undefined {
  const server = serverUnder(world.index, hostId);
  if (!server) return undefined;
  const cni = cniOfHost(world.index, hostId) ?? cniOfHost(world.index, server);
  if (cni && world.stateAs(cni.id, "cni").status === "down")
    return `${world.index.entity(hostId).name}: CNI 플러그인이 죽어 파드가 통신하지 못해요`;
  if (!segment) return undefined;
  const leaf = leafOfServer(world.index, server);
  const vtep = leaf ? vtepOfSwitch(world.index, leaf) : undefined;
  if (!vtep) return undefined;
  const seg = world.stateAs(segment.id, "overlay_segment");
  if (!seg.cutVteps.includes(vtep.id)) return undefined;
  return `${world.index.entity(hostId).name}: ${world.stateAs(vtep.id, "vtep").why ?? "VTEP이 세그먼트에서 끊겼어요"}`;
}

function placesVerdict(
  world: WorldReader,
  service: Entity,
  def: ServiceDef,
  segment: Entity | undefined,
): SdnVerdict {
  const places = world.stateAs(service.id, "service").runsOn;
  const cuts = places.map((id) => cutReason(world, id, segment));
  const dead = cuts.filter((c) => c !== undefined) as string[];
  if (dead.length === 0) return { status: "healthy", reasons: [] };
  const all = dead.length === places.length;
  const stops = all || def.kind === "stateful";
  return { status: stops ? "down" : "degraded", reasons: dead };
}

function ingressVerdict(
  world: WorldReader,
  ingress: Entity,
  def: ServiceDef,
): SdnVerdict | undefined {
  const s = world.stateAs(ingress.id, "ingress");
  if (s.status === "ok") return undefined;
  const why = `${ingress.name}: ${s.why ?? "인그레스가 막혀 밖에서 오는 요청이 닿지 않아요(클러스터 안의 호출은 그대로예요)"}`;
  if (s.status === "down" && def.kind === "request") return { status: "down", reasons: [why] };
  return { status: "degraded", reasons: [why] };
}

function nfvVerdict(world: WorldReader, nfv: Entity): SdnVerdict | undefined {
  const s = world.stateAs(nfv.id, "nfv_function");
  if (s.status === "ok") return undefined;
  const why = `${nfv.name}: ${s.why ?? `지연이 ${Math.round(s.latencyMs)}ms로 늘었어요`}`;
  return { status: s.status === "down" ? "down" : "degraded", reasons: [why] };
}

/**
 * The policies that cut this service off from a peer (REQ-100): the policies that guard it and deny, and the policies that
 * deny a service it calls (`calls`). A policy guards one service; the services that call it are the ones it hurts.
 */
function policyReasons(world: WorldReader, service: Entity): string[] {
  const denies = (policy: Entity): boolean =>
    world.stateAs(policy.id, "network_policy").rule === "deny";
  const own = policiesOf(world.index, service.id)
    .filter(denies)
    .map((p) => `${p.name}: 정책이 서비스 사이의 호출을 막고 있어요`);
  const callees = callsOut(world.index, service.id).flatMap((l) =>
    policiesOf(world.index, l.to)
      .filter(denies)
      .map((p) => `${p.name}: 정책이 ${world.index.find(l.to)?.name ?? l.to} 호출을 막고 있어요`),
  );
  return [...own, ...callees];
}

const SDN_KINDS = ["overlay_segment", "cni", "ingress", "nfv_function", "network_policy"] as const;

/** What the overlay and the cloud-native layer make of a service: the worst of every rule above. */
export function sdnHealth(world: WorldReader, service: Entity, def: ServiceDef): SdnVerdict {
  if (!SDN_KINDS.some((k) => world.index.ofKind(k).length > 0))
    return { status: "healthy", reasons: [] };
  let status: ServiceStatus = "healthy";
  const reasons: string[] = [];
  const add = (v: SdnVerdict | undefined): void => {
    if (!v || v.status === "healthy") return;
    status = worse(status, v.status);
    reasons.push(...v.reasons);
  };
  const deps = sdnDependencies(world.index, service.id);
  const segment = deps.find((d) => d.kind === "overlay_segment");
  if (segment) {
    const seg = world.stateAs(segment.id, "overlay_segment");
    if (seg.status === "down")
      add({ status: "down", reasons: [`${segment.name}: ${seg.why ?? "세그먼트가 끊겼어요"}`] });
  }
  add(placesVerdict(world, service, def, segment));
  for (const d of deps) {
    if (d.kind === "ingress") add(ingressVerdict(world, d, def));
    else if (d.kind === "nfv_function") add(nfvVerdict(world, d));
  }
  const blocked = policyReasons(world, service);
  if (blocked.length > 0) add({ status: "degraded", reasons: blocked });
  return { status, reasons };
}
