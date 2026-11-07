/**
 * The state of the site and DR layer (REQ-106): sites, the WAN link, the copy streams, the plan, geo volumes, the
 * consensus ring and the managed multi-AZ database. The rest of the world's state is in state.ts, which re-exports
 * these. Physics (physics/site.ts, physics/dbx.ts) keeps them current; site-health.ts and dbx-health.ts read them.
 */
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";
import { drPlanDef } from "./site-dr";
import type { EntityState } from "./state";

interface Base {
  health: "ok" | "warning" | "critical";
}

export type Level = "ok" | "degraded" | "down";

export interface DrSiteState extends Base {
  kind: "dr_site";
  status: Level;
  /** Servers of the site that are up, and all of them. */
  up: number;
  total: number;
  /** Days since the images of a cold site were made. */
  imageAgeDays: number;
  why?: string;
}

export interface SiteLinkState extends Base {
  kind: "site_link";
  status: Level;
  /** One-way latency now (ms). */
  latencyMs: number;
  /** How many times the normal lag a copy over this link trails. */
  lagFactor: number;
  why?: string;
}

export type StreamStatus = "ok" | "lagging" | "broken";

export interface StreamState extends Base {
  kind: "replication_stream";
  status: StreamStatus;
  /** The mode now: a synchronous copy falls back to asynchronous when the link cannot acknowledge. */
  mode: "async" | "sync";
  lagS: number;
  /** World time the copy began to stall (the link or the copy is out). */
  stalledSince?: number;
  why?: string;
}

export type PlanPhase = "idle" | "failing_over" | "failing_back" | "stuck";

export interface DrillResult {
  readonly rtoS: number;
  readonly rpoS: number;
  readonly meetsRto: boolean;
  readonly meetsRpo: boolean;
}

export interface DrPlanState extends Base {
  kind: "dr_plan";
  /** The site the services run at now. */
  serving: string;
  phase: PlanPhase;
  toSite?: string;
  startedAt?: number;
  completeAt?: number;
  /** An operator started the move (so its end is not the system's own doing). */
  byOperator: boolean;
  /** World time the serving site was first seen gone (hot and active sites move by themselves after the detect time). */
  downSince?: number;
  /** World times the sites were first seen gone, and well again (by site id; `up-` for the second). */
  lastMarks?: Record<string, number>;
  /** Sites a global balancer of an active-active pair took out of the rotation. */
  drained: string[];
  /** Seconds of writes lost at the last move. */
  lostS: number;
  failovers: number;
  lastDrillAt?: number;
  lastDrill?: DrillResult;
  /** Both sites took writes while cut off from each other. */
  split: boolean;
  why?: string;
}

export interface VolumeState extends Base {
  kind: "volume";
  /** The site that holds the writable copy. */
  primary: string;
  status: Level;
  lagS: number;
  promotedAt?: number;
  why?: string;
}

export interface DbNodeState extends Base {
  kind: "db_node";
  status: "ok" | "down" | "lagging";
  role: "leader" | "follower";
  term: number;
  lagS: number;
  /** A restart ended what held it down, although the fault is still on its neighbours. */
  revived: boolean;
  /** World time the ring was first seen without a leader. */
  leaderlessSince?: number;
  /** The ring had lost its majority: the election that follows is made possible by a restart, not by the cluster. */
  noMajority?: boolean;
  why?: string;
}

export interface DbManagedState extends Base {
  kind: "db_managed";
  status: Level;
  /** Index of the availability zone that holds the primary. */
  activeAz: number;
  /** Seconds until the write stall of a switch ends (writes fail until then). */
  stallUntil?: number;
  /** World time the active zone was first seen gone. */
  azDownSince?: number;
  failovers: number;
  /** An operator chose the zone; the provider no longer moves it by itself. */
  pinned: boolean;
  storageUsedPct: number;
  /** World time the storage was first seen full. */
  fullSince?: number;
  /** World time of the last switch (a flapping one switches every `FLAP_PERIOD_S`). */
  lastSwitchAt?: number;
  why?: string;
}

/** Every state this layer adds to the world. */
export type SiteEntityState =
  | DrSiteState
  | SiteLinkState
  | StreamState
  | DrPlanState
  | VolumeState
  | DbNodeState
  | DbManagedState;

type SiteFactory = () => SiteEntityState;

export const SITE_FACTORIES: Readonly<
  Record<
    | "dr_site"
    | "site_link"
    | "replication_stream"
    | "dr_plan"
    | "volume"
    | "db_node"
    | "db_managed",
    SiteFactory
  >
> = {
  dr_site: () => ({
    kind: "dr_site",
    health: "ok",
    status: "ok",
    up: 0,
    total: 0,
    imageAgeDays: 7,
  }),
  site_link: () => ({ kind: "site_link", health: "ok", status: "ok", latencyMs: 3, lagFactor: 1 }),
  replication_stream: () => ({
    kind: "replication_stream",
    health: "ok",
    status: "ok",
    mode: "async",
    lagS: 0,
  }),
  dr_plan: () => ({
    kind: "dr_plan",
    health: "ok",
    serving: "",
    phase: "idle",
    byOperator: false,
    drained: [],
    lostS: 0,
    failovers: 0,
    split: false,
  }),
  volume: () => ({ kind: "volume", health: "ok", primary: "", status: "ok", lagS: 0 }),
  db_node: () => ({
    kind: "db_node",
    health: "ok",
    status: "ok",
    role: "follower",
    term: 1,
    lagS: 0,
    revived: false,
  }),
  db_managed: () => ({
    kind: "db_managed",
    health: "ok",
    status: "ok",
    activeAz: 0,
    failovers: 0,
    pinned: false,
    storageUsedPct: 62,
  }),
};

/** The plan serves from its primary site, a stream copies the way its props say, the first node of a ring leads. */
export function placeSite(state: EntityState, entity: Entity, index: BlueprintIndex): void {
  if (state.kind === "dr_plan") state.serving = drPlanDef(entity).primary;
  if (state.kind === "replication_stream" && entity.props.mode === "sync") state.mode = "sync";
  if (state.kind === "volume") state.primary = String(entity.props.primarySite ?? "");
  if (state.kind === "dr_site" && typeof entity.props.imageAgeDays === "number")
    state.imageAgeDays = entity.props.imageAgeDays;
  if (state.kind === "db_node") {
    state.role = entity.props.leader === true ? "leader" : "follower";
    void index;
  }
}
