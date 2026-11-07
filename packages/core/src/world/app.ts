/**
 * The application layer (REQ-100, ADR-0121, docs/design-docs/application-layer.md): what stands between a user and the
 * process that answers, and what the processes of one service say to each other.
 *
 * A service has replicas (`app_instance`, one per place it runs), a load balancer in front of them, and from the stateless
 * choice on an external session store. Services call each other with the `calls` link; from the microservices choice on a
 * circuit breaker watches every call. The mesh choice puts a sidecar next to every replica and a control plane over the
 * sidecars. The multi-region choice stands two regions, each with a full stack, behind a global load balancer.
 * Settings are props; the state of each is kept by physics (physics/app.ts); health is read in app-health.ts.
 */
import type { Entity, Link } from "./blueprint";
import type { BlueprintIndex } from "./graph";

/** Seconds between two health checks of a load balancer; a backend is taken out after 3 failed checks. */
export const LB_INTERVAL_S = 5;
export const LB_FAIL_CHECKS = 3;
export const LB_RECOVER_CHECKS = 2;
/** Failures in a row (one a second while the callee is down) that make a breaker open, and the seconds it stays open. */
export const BREAKER_FAILURES = 5;
export const BREAKER_RESET_S = 30;
/** Seconds a global load balancer needs to see a region gone (health checks and the DNS time to live). */
export const REGION_DETECT_S = 300;
/** Seconds a region has to be well before the global balancer sends traffic to it again. */
export const REGION_RECOVER_S = 60;
/** Seconds after a region leaves the rotation that its users must log in again (their sessions were in that region). */
export const RELOGIN_S = 120;
/** Replication lag (seconds) at which a read from the lagging region is stale. */
export const STALE_LAG_S = 30;
/** The mesh configuration revision every sidecar holds when nothing was pushed. */
export const MESH_REVISION = 7;
/** The processes of the session store, a sidecar and the mesh control plane, as `systemctl` names them. */
export const SESSION_PROCESS = "redis-server";
export const SIDECAR_PROCESS = "envoy";
export const MESH_PROCESS = "istiod";
/** The job scheduler of the GPU layer (REQ-107). */
export const SCHEDULER_PROCESS = "slurmctld";

const num = (props: Entity["props"], key: string): number | undefined =>
  typeof props[key] === "number" ? (props[key] as number) : undefined;

export interface LoadBalancerDef {
  readonly intervalS: number;
  /** A global balancer chooses between regions; a plain one between the replicas of one service. */
  readonly global: boolean;
  /** Seconds to see a region gone (global only). */
  readonly detectS: number;
}
export const loadBalancerDef = (e: Entity): LoadBalancerDef => ({
  intervalS: num(e.props, "intervalS") ?? LB_INTERVAL_S,
  global: e.props.scope === "global",
  detectS: num(e.props, "detectS") ?? REGION_DETECT_S,
});

export interface BreakerDef {
  /** The `calls` link it watches. */
  readonly link: string;
  readonly failures: number;
  readonly resetS: number;
}
export const breakerDef = (e: Entity): BreakerDef => ({
  link: typeof e.props.link === "string" ? e.props.link : "",
  failures: num(e.props, "failures") ?? BREAKER_FAILURES,
  resetS: num(e.props, "resetS") ?? BREAKER_RESET_S,
});

export interface CallDef {
  /** The caller cannot work without the answer. */
  readonly critical: boolean;
  /** Calls made for one request. */
  readonly fanout: number;
  readonly timeoutMs: number;
}
export const callDef = (link: Link): CallDef => ({
  critical: link.props.critical === true,
  fanout: num(link.props, "fanout") ?? 1,
  timeoutMs: num(link.props, "timeoutMs") ?? 2000,
});

const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);

const kindOf = (index: BlueprintIndex, kind: Entity["kind"], ids: readonly string[]): Entity[] =>
  ids
    .map((id) => index.find(id))
    .filter((e): e is Entity => e?.kind === kind)
    .sort(byId);

/** The replicas of a service, by id. */
export const appInstancesOf = (index: BlueprintIndex, serviceId: string): Entity[] =>
  kindOf(
    index,
    "app_instance",
    index.incoming(serviceId, "member_of").map((l) => l.from),
  );

/** The load balancer in front of a service (the global one when it has both), if any. */
export function lbOf(index: BlueprintIndex, serviceId: string): Entity | undefined {
  const all = kindOf(
    index,
    "load_balancer",
    index.outgoing(serviceId, "depends_on").map((l) => l.to),
  );
  return all.find((e) => loadBalancerDef(e).global) ?? all[0];
}

/** The services behind a load balancer. */
export const servicesBehind = (index: BlueprintIndex, lbId: string): Entity[] =>
  kindOf(
    index,
    "service",
    index.incoming(lbId, "depends_on").map((l) => l.from),
  );

export const sessionStoreOf = (index: BlueprintIndex, serviceId: string): Entity | undefined =>
  kindOf(
    index,
    "session_store",
    index.outgoing(serviceId, "depends_on").map((l) => l.to),
  )[0];

/** The host (VM or server) an instance, balancer, store or control plane stands on. */
export const hostOfApp = (index: BlueprintIndex, id: string): string | undefined => {
  const to = index.outgoing(id, "hosted_on")[0]?.to;
  return to && index.find(to)?.kind === "app_instance" ? hostOfApp(index, to) : to;
};

/** The sidecar next to an instance. */
export const sidecarOf = (index: BlueprintIndex, instanceId: string): Entity | undefined =>
  kindOf(
    index,
    "mesh_sidecar",
    index.incoming(instanceId, "hosted_on").map((l) => l.from),
  )[0];

/** The instance a sidecar stands next to. */
export const instanceOfSidecar = (index: BlueprintIndex, sidecarId: string): string | undefined =>
  index.outgoing(sidecarId, "hosted_on")[0]?.to;

export const meshControls = (index: BlueprintIndex): Entity[] =>
  [...index.ofKind("mesh_control")].sort(byId);

/** The region an instance stands in. */
export const regionOf = (index: BlueprintIndex, instanceId: string): Entity | undefined =>
  kindOf(
    index,
    "region",
    index.outgoing(instanceId, "member_of").map((l) => l.to),
  )[0];

/** The regions a global balancer chooses between, by id. */
export const regionsOf = (index: BlueprintIndex, lbId: string): Entity[] =>
  kindOf(
    index,
    "region",
    index.incoming(lbId, "member_of").map((l) => l.from),
  );

/** The `calls` links that leave an entity (it is the caller) and that arrive at it (it is the callee). */
export const callsOut = (index: BlueprintIndex, id: string): readonly Link[] =>
  index.outgoing(id, "calls");
export const callsIn = (index: BlueprintIndex, id: string): readonly Link[] =>
  index.incoming(id, "calls");

/** The breaker that watches a `calls` link, if any. */
export const breakerOfLink = (index: BlueprintIndex, linkId: string): Entity | undefined =>
  index.ofKind("circuit_breaker").find((b) => b.props.link === linkId);

/** The breakers of the world, by id. */
export const breakers = (index: BlueprintIndex): Entity[] =>
  [...index.ofKind("circuit_breaker")].sort(byId);

/** The caller and callee ends of a breaker's link. */
export const breakerEnds = (
  index: BlueprintIndex,
  breaker: Entity,
): { from: string; to: string } | undefined => {
  const id = breakerDef(breaker).link;
  const l = id && index.allLinks().find((x) => x.id === id);
  return l ? { from: l.from, to: l.to } : undefined;
};
