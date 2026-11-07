/**
 * The state of the application layer (REQ-100): replicas and whether the balancer sends them traffic, balancers, session
 * stores, breakers, sidecars, the mesh control plane and regions. The rest of the world's state is in state.ts, which
 * re-exports these. Physics (physics/app.ts) keeps them current; app-health.ts and calls-health.ts read them.
 */

import { MESH_REVISION } from "./app";
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";
import type { EntityState } from "./state";

interface Base {
  health: "ok" | "warning" | "critical";
}

export type AppStatus = "ok" | "degraded" | "down";

/** A replica of a service. `inRotation` is the balancer's view: it sends traffic only to replicas in rotation. */
export interface AppInstanceState extends Base {
  kind: "app_instance";
  status: AppStatus;
  why?: string;
  inRotation: boolean;
  /** An operator took it out of the rotation; the balancer ignores its health checks until it is put back. */
  drained: boolean;
  /** Its health check answers yes and no by turns. */
  flapping: boolean;
  /** World time the checks began to fail, or began to pass again. */
  badSince?: number;
  goodSince?: number;
}

export interface LoadBalancerState extends Base {
  kind: "load_balancer";
  status: AppStatus;
  why?: string;
  /** A global balancer: the regions that get traffic now. */
  rotation: string[];
  /** An operator sent all traffic to this region; the balancer no longer moves it by itself. */
  pinned?: string;
  regionBadSince: Record<string, number>;
  regionGoodSince: Record<string, number>;
  /** Users of a region that left the rotation log in again until this time. */
  reloginUntil?: number;
}

export interface SessionStoreState extends Base {
  kind: "session_store";
  status: "ok" | "down";
  why?: string;
}

export type BreakerMode = "closed" | "open" | "half-open";

export interface BreakerState extends Base {
  kind: "circuit_breaker";
  mode: BreakerMode;
  /** World time the callee was first seen failing (closed), or the breaker opened. */
  failingSince?: number;
  openedAt?: number;
  trips: number;
  /** A fault holds it open whatever the callee does. */
  stuck: boolean;
  why?: string;
}

export interface SidecarState extends Base {
  kind: "mesh_sidecar";
  status: "ok" | "down";
  mtls: boolean;
  revision: number;
  why?: string;
}

export interface MeshControlState extends Base {
  kind: "mesh_control";
  status: "ok" | "down";
  revision: number;
  /** The revision before the last push (what a rollback goes back to). */
  previous: number;
  retries: "sane" | "aggressive";
  why?: string;
}

export interface RegionState extends Base {
  kind: "region";
  status: "ok" | "down";
  /** Seconds the copy of the data in this region trails the primary region's. */
  lagS: number;
  why?: string;
}

type StateFactory = () =>
  | AppInstanceState
  | LoadBalancerState
  | SessionStoreState
  | BreakerState
  | SidecarState
  | MeshControlState
  | RegionState;

export const APP_FACTORIES: Readonly<
  Record<
    | "app_instance"
    | "load_balancer"
    | "session_store"
    | "circuit_breaker"
    | "mesh_sidecar"
    | "mesh_control"
    | "region",
    StateFactory
  >
> = {
  app_instance: () => ({
    kind: "app_instance",
    health: "ok",
    status: "ok",
    inRotation: true,
    drained: false,
    flapping: false,
  }),
  load_balancer: () => ({
    kind: "load_balancer",
    health: "ok",
    status: "ok",
    rotation: [],
    regionBadSince: {},
    regionGoodSince: {},
  }),
  session_store: () => ({ kind: "session_store", health: "ok", status: "ok" }),
  circuit_breaker: () => ({
    kind: "circuit_breaker",
    health: "ok",
    mode: "closed",
    trips: 0,
    stuck: false,
  }),
  mesh_sidecar: () => ({
    kind: "mesh_sidecar",
    health: "ok",
    status: "ok",
    mtls: true,
    revision: MESH_REVISION,
  }),
  mesh_control: () => ({
    kind: "mesh_control",
    health: "ok",
    status: "ok",
    revision: MESH_REVISION,
    previous: MESH_REVISION,
    retries: "sane",
  }),
  region: () => ({ kind: "region", health: "ok", status: "ok", lagS: 0.5 }),
};

/** A global balancer starts with every region of it in the rotation. */
export function placeApp(state: EntityState, entity: Entity, index: BlueprintIndex): void {
  if (state.kind !== "load_balancer") return;
  state.rotation = index
    .incoming(entity.id, "member_of")
    .map((l) => l.from)
    .filter((id) => index.find(id)?.kind === "region")
    .sort();
}
