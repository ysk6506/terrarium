/**
 * The application layer of a "서비스부터" world (REQ-100, ADR-0121): the calls between services the person wrote down, and
 * from the "stateless" choice on a balancer in front of each service, a replica object for each place it runs, a session
 * store, a circuit breaker on every call, a sidecar next to every replica with a mesh control plane over them, and with the
 * multi-region choice a second region with the same stack behind a global balancer (the hosts are doubled, the first half
 * of them is region A and the second half region B). A choice keeps what the one before it built.
 */
import type { AppBuild, BlueprintIndex } from "@terrarium/core/world";
import { type Laying, link, slugOf } from "./shaped-db";
import type { PlacedService } from "./shaped-sdn";

/** What the application layer needs of one service. */
export interface AppService extends PlacedService {
  /** The services it calls, by key. */
  readonly calls: readonly string[];
  /** What its application choice builds (absent: the choice builds nothing around the service). */
  readonly build: AppBuild | undefined;
  /** The hosts its nodes stand on, in order: the first half is region A, the second region B. */
  readonly hosts: readonly string[];
}

export interface AppPlace {
  readonly index: BlueprintIndex;
}

/** The server a node stands on: itself, or the machine its VM runs on. */
function serverOf(into: Laying, index: BlueprintIndex, node: string): string | undefined {
  if (index.find(node)?.kind === "server") return node;
  return into.links.find((l) => l.kind === "runs_on" && l.from === node)?.to;
}

/** The calls the person wrote down: a link from each service to those it calls; a call to a stateful service is critical. */
export function layCalls(into: Laying, services: readonly AppService[]): string[] {
  const made: string[] = [];
  const byKey = new Map(services.map((s) => [s.key, s]));
  for (const svc of services)
    for (const key of svc.calls) {
      const callee = byKey.get(key);
      if (!callee || callee.id === svc.id) continue;
      const id = `calls-${slugOf(svc.id)}-${slugOf(callee.id)}`;
      if (made.includes(id)) continue;
      made.push(id);
      into.links.push({
        id,
        kind: "calls",
        from: svc.id,
        to: callee.id,
        props: { critical: callee.kind === "stateful", fanout: 1, timeoutMs: 2000 },
      });
    }
  return made;
}

function layRegions(into: Laying): void {
  into.entities.push(
    { id: "region-a", kind: "region", name: "리전 A", props: { primary: true } },
    { id: "region-b", kind: "region", name: "리전 B", props: { primary: false } },
  );
}

function layInstances(into: Laying, place: AppPlace, svc: AppService, build: AppBuild): string[] {
  const half = Math.ceil(svc.hosts.length / 2);
  return svc.nodes.map((node, i) => {
    const id = `app-${slugOf(svc.id)}-${i + 1}`;
    into.entities.push({
      id,
      kind: "app_instance",
      name: `${svc.name} 인스턴스 ${i + 1}`,
      props: {},
    });
    link(into, "hosted_on", id, node);
    link(into, "member_of", id, svc.id);
    if (build.regions === 2) {
      const server = serverOf(into, place.index, node);
      const at = server ? svc.hosts.indexOf(server) : -1;
      link(into, "member_of", id, at >= half ? "region-b" : "region-a");
    }
    return id;
  });
}

function layBalancer(into: Laying, svc: AppService, build: AppBuild): void {
  const id = `lb-${slugOf(svc.id)}`;
  const global = build.regions === 2;
  into.entities.push({
    id,
    kind: "load_balancer",
    name: `${svc.name} ${global ? "글로벌 " : ""}로드 밸런서`,
    props: global ? { scope: "global" } : { scope: "service" },
  });
  const host = svc.nodes[0];
  if (host) link(into, "hosted_on", id, host);
  link(into, "depends_on", svc.id, id);
  if (global) for (const r of ["region-a", "region-b"]) link(into, "member_of", r, id);
}

function laySession(into: Laying, svc: AppService): void {
  const host = svc.nodes[svc.nodes.length - 1];
  if (!host) return;
  const id = `sess-${slugOf(svc.id)}`;
  into.entities.push({ id, kind: "session_store", name: `${svc.name} 세션 저장소`, props: {} });
  link(into, "hosted_on", id, host);
  link(into, "depends_on", svc.id, id);
}

function layMesh(into: Laying, instances: readonly string[], svc: AppService, host: string): void {
  if (!into.entities.some((e) => e.id === "mesh-control")) {
    into.entities.push({
      id: "mesh-control",
      kind: "mesh_control",
      name: "메시 컨트롤 플레인",
      props: {},
    });
    link(into, "hosted_on", "mesh-control", host);
  }
  for (const [i, inst] of instances.entries()) {
    const id = `sc-${slugOf(svc.id)}-${i + 1}`;
    into.entities.push({
      id,
      kind: "mesh_sidecar",
      name: `${svc.name} 사이드카 ${i + 1}`,
      props: {},
    });
    link(into, "hosted_on", id, inst);
    link(into, "member_of", id, "mesh-control");
  }
}

function layBreakers(into: Laying, calls: readonly string[]): void {
  for (const linkId of calls) {
    const l = into.links.find((x) => x.id === linkId);
    if (!l) continue;
    into.entities.push({
      id: `cb-${linkId.replace(/^calls-/, "")}`,
      kind: "circuit_breaker",
      name: `서킷 브레이커 ${linkId.replace(/^calls-/, "")}`,
      props: { link: linkId },
    });
  }
}

/** Everything the application choice adds to a world, once every service is placed. */
export function layApp(into: Laying, place: AppPlace, services: readonly AppService[]): void {
  const calls = layCalls(into, services);
  if (services.some((s) => s.build?.regions === 2)) layRegions(into);
  for (const svc of services) {
    const build = svc.build;
    if (!build) continue;
    const instances = layInstances(into, place, svc, build);
    if (svc.kind !== "batch") layBalancer(into, svc, build);
    if (build.sessionStore && svc.kind === "request") laySession(into, svc);
    const host = svc.nodes[0];
    if (build.mesh && host) layMesh(into, instances, svc, host);
  }
  if (services.some((s) => s.build?.breakers)) layBreakers(into, calls);
}
