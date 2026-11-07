/**
 * The worlds and sheets the built-in reference agents are tried on (REQ-108, ADR-0131): one row for each sheet of every
 * layer that has a scenario with services, in the small world that layer's own tests use, and what `operator`, `triage`
 * and `guess` scored on it before they knew the site, GPU and power layers (ADR-0131 measured them on the code of
 * a7cc302). A later change must not take points off these.
 */

import { DEFAULT_SHAPE, generateShaped } from "@terrarium/core/sources/worldgen";
import type { Blueprint } from "@terrarium/core/world";
import { appLab } from "../../../packages/core/src/world/test-support/app-lab";
import { dbLab } from "../../../packages/core/src/world/test-support/db-lab";
import { k8sLab } from "../../../packages/core/src/world/test-support/k8s-lab";
import { sdnLab } from "../../../packages/core/src/world/test-support/sdn-lab";
import { siteBlueprint } from "../site-support";
import { accelLab, powerLab } from "./ladder-labs";

export interface Row {
  readonly template: string;
  readonly world: string;
  readonly make: () => Blueprint;
  /** Scores of the old `operator`, `triage` and `guess` on this row. */
  readonly before: { readonly operator: number; readonly triage: number; readonly guess: number };
}

const row = (
  template: string,
  world: string,
  make: () => Blueprint,
  operator: number,
  triage: number,
  guess: number,
): Row => ({ template, world, make, before: { operator, triage, guess } });

const train = () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" });
const pod = () =>
  accelLab("gpu-liquid-pod", {
    network: "net-leaf-spine",
    cooling: "cool-liquid",
    power: "pwr-ab",
  });

/** The layers above the servers, which the baselines now know. */
export const LAYER_ROWS: readonly Row[] = [
  row("site-power-loss", "cold", () => siteBlueprint("cold"), 0, 0, 0),
  row("site-power-loss", "warm", () => siteBlueprint("warm"), 0, 0, 0),
  row("site-power-loss", "hot", () => siteBlueprint("hot"), 0, 0, 0),
  row("site-power-loss", "active", () => siteBlueprint("active"), 0, 0, 0),
  row("dr-failover-stuck", "warm", () => siteBlueprint("warm"), 0, 0, 0),
  row("wan-link-cut", "warm", () => siteBlueprint("warm"), 0, 18, 0),
  row("wan-link-cut", "hot", () => siteBlueprint("hot"), 0, 18, 0),
  row("replication-broken", "warm", () => siteBlueprint("warm"), 0, 18, 18),
  row("split-brain", "split", () => siteBlueprint("split"), 0, 18, 18),
  row("db-quorum-lost", "raft", () => siteBlueprint("raft"), 0, 0, 0),
  row("geo-replica-broken", "warm", () => siteBlueprint("warm"), 0, 18, 18),
  row("gpu-xid-error", "train", train, 0, 18, 18),
  row("job-stuck-checkpoint", "train", train, 0, 0, 0),
  row("cdu-pump-fail", "pod", pod, 0, 18, 0),
  row("utility-feed-loss", "power", () => powerLab("pwr-substation"), 0, 24, 0),
];

/** Sheets of the layers below, where the baselines do what they did before, only not touching a cluster that heals. */
export const OTHER_ROWS: readonly Row[] = [
  row("db-managed-flapping", "managed", () => siteBlueprint("managed"), 0, 0, 0),
  row("db-managed-storage-full", "managed", () => siteBlueprint("managed"), 0, 0, 0),
  row("k8s-worker-down", "k8s", () => k8sLab(), 0, 18, 18),
  row("k8s-crashloop", "k8s", () => k8sLab(), 0, 0, 0),
  row("k8s-etcd-quorum", "k8s", () => k8sLab(), 0, 18, 18),
  row("k8s-pending", "k8s", () => k8sLab({ webReplicas: 6, webMilli: 1200 }), 0, 0, 0),
  row(
    "k8s-disk-pressure",
    "shaped",
    () => generateShaped({ ...DEFAULT_SHAPE, servers: 48 }).blueprint,
    0,
    18,
    18,
  ),
  row("sdn-controller-down", "two controllers", () => sdnLab({ controllers: 2 }), 0, 18, 18),
  row("sdn-controller-down", "one controller", () => sdnLab({ controllers: 1 }), 0, 18, 18),
  row("sdn-sync-failed", "sdn", () => sdnLab({}), 0, 0, 0),
  row("sdn-tunnel-down", "sdn", () => sdnLab({}), 0, 0, 0),
  row("netpolicy-wrong-deploy", "cloud native", () => sdnLab({ cloudNative: true }), 0, 18, 18),
  row("ingress-down", "cloud native", () => sdnLab({ cloudNative: true }), 0, 18, 18),
  row("cni-plugin-failure", "cloud native", () => sdnLab({ cloudNative: true }), 0, 18, 18),
  row("lb-backend-flapping", "lb", () => appLab({ level: "lb" }), 0, 18, 18),
  row("session-store-down", "stateless", () => appLab({ level: "stateless" }), 0, 18, 18),
  row("breaker-stuck-open", "microservices", () => appLab({ level: "microservices" }), 0, 18, 18),
  row("retry-storm", "mesh", () => appLab({ level: "mesh" }), 0, 18, 18),
  row("sidecar-crash", "mesh", () => appLab({ level: "mesh" }), 0, 0, 0),
  row("mesh-control-stuck", "mesh", () => appLab({ level: "mesh" }), 0, 18, 18),
  row("region-down", "multiregion", () => appLab({ level: "multiregion" }), 0, 18, 0),
  row("db-primary-down", "replicated", () => dbLab({ shape: "replicated" }), 0, 18, 18),
  row("db-replication-broken", "replicated", () => dbLab({ shape: "replicated" }), 0, 18, 18),
  row("db-split-brain", "auto failover", () => dbLab({ shape: "auto_failover" }), 0, 18, 18),
  row(
    "db-shared-path-cut",
    "shared",
    () => dbLab({ shape: "shared_aa", storage: "dual" }),
    0,
    0,
    0,
  ),
  row(
    "storage-node-lost",
    "distributed",
    () => dbLab({ shape: "replicated", storage: "distributed" }),
    0,
    18,
    0,
  ),
  row("db-restore-corrupt-backup", "single", () => dbLab({ shape: "single" }), 0, 18, 18),
];
