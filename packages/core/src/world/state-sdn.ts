/**
 * The state of the SDN overlay and cloud-native network entities (REQ-097). The rest of the world's state is in
 * state.ts, which re-exports these. Physics (physics/sdn.ts) keeps them current; sdn-health.ts reads them.
 */
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";
import { type PolicyRule, policyRuleOf, sdnControllerDef } from "./sdn";
import type { EntityState } from "./state";

interface Base {
  health: "ok" | "warning" | "critical";
}

/** An SDN controller: active or waiting, up or down, and the clock of the standby's takeover. */
export interface SdnControllerState extends Base {
  kind: "sdn_controller";
  role: "active" | "standby";
  status: "ok" | "down";
  /** Switches whose VTEP it manages now (0 for a standby). */
  managed: number;
  /** The revision of the configuration it holds. */
  revision: number;
  /** World time the standby first found the active one gone. */
  downSince?: number;
  why?: string;
}

/** A VTEP: the EVPN session with the spines, whether it holds the latest configuration, and why it is cut off. */
export interface VtepState extends Base {
  kind: "vtep";
  evpn: "established" | "down";
  /** World time the session is up again after what broke it is gone (the BGP timers run). */
  evpnUpAt?: number;
  /** The configuration revision it holds; behind the controller's when the last push did not reach it. */
  revision: number;
  /** Times the session went down and came back while it flapped. */
  flaps: number;
  /** Not reachable by the other VTEPs of its segments (a tunnel is cut), or cut by its own state. */
  cut: boolean;
  /** Uplink cables that carry traffic now (the ECMP paths of the leaf). */
  uplinks: number;
  /** The last reset of the session was an operator's (so its coming back is not the system's own doing). */
  byOperator?: boolean;
  why?: string;
}

export interface OverlaySegmentState extends Base {
  kind: "overlay_segment";
  status: "ok" | "degraded" | "down";
  /** The VTEPs of the segment that are cut off from the rest of it. */
  cutVteps: string[];
  why?: string;
}

export interface NfvState extends Base {
  kind: "nfv_function";
  status: "ok" | "degraded" | "down";
  loadPct: number;
  latencyMs: number;
  why?: string;
}

export interface CniState extends Base {
  kind: "cni";
  status: "ok" | "down";
  why?: string;
}

/** A network policy: what it does now, and what it did before the last change (to put it back). */
export interface NetworkPolicyState extends Base {
  kind: "network_policy";
  rule: PolicyRule;
  previous: PolicyRule;
  changedAt: number;
}

export interface IngressState extends Base {
  kind: "ingress";
  status: "ok" | "degraded" | "down";
  /** World time the restarted controller is up. */
  upAt?: number;
  why?: string;
}

type StateFactory = () =>
  | SdnControllerState
  | VtepState
  | OverlaySegmentState
  | NfvState
  | CniState
  | NetworkPolicyState
  | IngressState;

export const SDN_FACTORIES: Readonly<
  Record<
    | "sdn_controller"
    | "vtep"
    | "overlay_segment"
    | "nfv_function"
    | "cni"
    | "network_policy"
    | "ingress",
    StateFactory
  >
> = {
  sdn_controller: () => ({
    kind: "sdn_controller",
    health: "ok",
    role: "active",
    status: "ok",
    managed: 0,
    revision: 42,
  }),
  vtep: () => ({
    kind: "vtep",
    health: "ok",
    evpn: "established",
    revision: 42,
    flaps: 0,
    cut: false,
    uplinks: 0,
  }),
  overlay_segment: () => ({ kind: "overlay_segment", health: "ok", status: "ok", cutVteps: [] }),
  nfv_function: () => ({
    kind: "nfv_function",
    health: "ok",
    status: "ok",
    loadPct: 30,
    latencyMs: 1,
  }),
  cni: () => ({ kind: "cni", health: "ok", status: "ok" }),
  network_policy: () => ({
    kind: "network_policy",
    health: "ok",
    rule: "allow",
    previous: "allow",
    changedAt: 0,
  }),
  ingress: () => ({ kind: "ingress", health: "ok", status: "ok" }),
};

/** Roles and rules start where the blueprint's props put them. */
export function placeSdn(state: EntityState, entity: Entity, index: BlueprintIndex): void {
  if (state.kind === "sdn_controller") {
    state.role = sdnControllerDef(entity).role;
    state.managed = state.role === "active" ? index.outgoing(entity.id, "controls").length : 0;
  } else if (state.kind === "network_policy") {
    state.rule = policyRuleOf(entity);
    state.previous = state.rule;
  }
}
