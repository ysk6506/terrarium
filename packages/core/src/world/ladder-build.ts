/** What a ladder choice makes of a generated world (REQ-094..100): the build info a chip carries, split from ladder.ts for size. */
import type { DbShape } from "./db";

/** What a chip makes of the generated world. Absent fields leave the generator's default alone. */
export interface ChipBuild {
  /** Spine switches per server room. */
  readonly spines?: number;
  /** Hosts a service needs for its nodes: how nodes share hosts (`pack`), and spare hosts kept idle. */
  readonly pack?: number;
  readonly spareHosts?: number;
  /** Services run on servers directly, no virtual machines. */
  readonly bare?: boolean;
  /** Services take a place on a shared storage array. */
  readonly sharedStorage?: boolean;
  /** Power feeds into every rack. */
  readonly feeds?: 1 | 2;
  readonly cooling?: "N" | "N+1" | "2N";
  readonly containment?: boolean;
  /** Server rooms, and whether they stand in separate buildings. */
  readonly rooms?: number;
  readonly buildings?: number;
  /** The storage pool the storage choice builds, and the database the database choice builds. */
  readonly pool?: PoolBuild;
  readonly database?: DatabaseBuild;
  /** The overlay and cloud-native network the network choice builds on the leaf-spine (REQ-097). */
  readonly overlay?: OverlayBuild;
  /** The hosts' cluster moves VMs by itself when one host is hot (DRS, REQ-096). */
  readonly drs?: boolean;
  /** The service runs on Kubernetes: this many clusters, each with its control plane, workers and workloads (REQ-096). */
  readonly k8s?: K8sBuild;
  /** The application layer the app choice builds for every service: balancer, replicas, sessions, breakers, mesh, regions (REQ-100). */
  readonly app?: AppBuild;
}

/**
 * What an application choice from "stateless" up builds around every service. Each choice keeps what the one before it had:
 * a balancer and one replica object per place the service runs, then an external session store, a circuit breaker on every
 * call, a sidecar next to every replica with a mesh control plane over them, and a second region behind a global balancer.
 */
export interface AppBuild {
  readonly sessionStore: boolean;
  readonly breakers: boolean;
  readonly mesh: boolean;
  /** Regions, each with a full stack of the service (the hosts are doubled). */
  readonly regions: 1 | 2;
}

/** The SDN overlay a network chip builds: a controller pair, a VTEP per leaf, a segment per service, and for cloud native the pod network. */
export interface OverlayBuild {
  /** SDN controllers: one active, the rest standby. */
  readonly controllers: number;
  /** A virtual firewall in the way of every service (a network function). */
  readonly nfv: boolean;
  /** A CNI plugin per node, a network policy and an ingress per service. */
  readonly cloudNative: boolean;
}

/** The Kubernetes clusters a chip builds for every service: how many (two keep each other up). */
export interface K8sBuild {
  readonly clusters: 1 | 2;
}

/** The storage pool a chip builds (REQ-095): two controllers and two paths, or nodes holding copies. */
export interface PoolBuild {
  readonly mode: "dual" | "distributed";
  /** Whether the hosts switch to the other path by themselves (a dual pool). */
  readonly multipath?: boolean;
  /** Nodes of a distributed pool: one more than the copies, so a lost node can be made again. */
  readonly nodes?: number;
  readonly copies?: number;
}

/** The database cluster a chip builds for every service (REQ-095). */
export interface DatabaseBuild {
  readonly shape: DbShape;
  /** Instances, the primary included. */
  readonly instances: number;
  readonly failover: "manual" | "auto";
  readonly detectS?: number;
  /** Voting members; a witness counts as one. */
  readonly quorum?: number;
  /** The instances keep their data on one shared disk (a storage pool) and not on their own. */
  readonly sharedDisk?: boolean;
}
