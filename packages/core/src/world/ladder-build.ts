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
  /** The second site the site choice builds, from a cold DR site up to active-active (REQ-106). */
  readonly site?: SiteBuild;
  /** Volumes keep a copy at the other site (the geo-replicated storage choice, REQ-106). */
  readonly geo?: boolean;
  /** A consensus database ring or a managed multi-AZ database in place of a db_cluster (REQ-106). */
  readonly dbx?: DbxBuild;
  /** The accelerator layer the accel choice builds: GPU servers, their NVLink, the fabric, the scheduler, jobs and the pool (REQ-107). */
  readonly accel?: AccelBuild;
  /** What the power choice adds around the UPS: spare modules, generators, rack batteries, 48 V DC, an own substation (REQ-107). */
  readonly power?: PowerBuild;
  /** How the dense racks are cooled: rear doors, direct-to-chip plates or an immersion tank (REQ-107). */
  readonly liquid?: "rdhx" | "dlc" | "immersion";
}

/**
 * The accelerator layer. `server`: a few GPU servers, one serving process each. `pool`: a balancer over a node pool of GPU
 * servers with MIG. `training`: NVLink in every node, an IB/RoCE fabric, a scheduler and a training job with spares.
 * `pod`: the same on liquid-cooled racks.
 */
export interface AccelBuild {
  readonly mode: "server" | "pool" | "training" | "pod";
  /** GPU servers, the spares the job can move to included. */
  readonly servers: number;
  readonly spares: number;
  /** GPUs of a server that are populated (2..8). */
  readonly gpusPerServer: number;
  /** The scale-out fabric between the nodes; absent: none. */
  readonly fabric?: "ib" | "roce";
  readonly scheduler: boolean;
  readonly job: boolean;
  readonly pool: boolean;
  readonly mig: boolean;
}

/** What the power choices from N+1 UPS up build, each keeping what the one before it had. */
export interface PowerBuild {
  /** One more UPS module per side than the load needs (N+1), all feeding every panel of the side. */
  readonly upsSpare?: boolean;
  /** An ATS and diesel generators per side; the hours of fuel on site; one more generator than the load needs. */
  readonly generator?: boolean;
  readonly fuelHours?: number;
  readonly spareGenerator?: boolean;
  /** A battery pack and a 48 V DC bus in every rack (OCP style). */
  readonly rackBattery?: boolean;
  /** An own substation with two transformers on two utility feeds in front of the ATS. */
  readonly substation?: boolean;
}

/** What the site choice builds beyond the first site: the second site's mode, its distance and its share of the hardware. */
export interface SiteBuild {
  readonly mode: "cold" | "warm" | "hot" | "active";
  /** Kilometres between the sites; the one-way latency of the link follows from it. */
  readonly distanceKm: number;
  /** Share of a service's nodes that stand at the second site (cold keeps all of them, powered off). */
  readonly share: number;
}

/** A database that is not a `db_cluster`: a ring of voting nodes (Raft), or a managed service over availability zones. */
export type DbxBuild =
  | { readonly kind: "raft"; readonly nodes: number }
  | { readonly kind: "managed"; readonly azs: 2 | 3 };

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
