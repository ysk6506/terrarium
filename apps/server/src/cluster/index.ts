/** server.cluster: scale-out — worker nodes, the node registry, placement and autoscaler metrics (ADR-0032). */
export { ClusterHost, type ClusterHostOptions } from "./cluster-host";
export {
  type ControlDeps,
  type Load,
  loadOf,
  metricsText,
  registerControl,
} from "./control-routes";
export { Heartbeat, type HeartbeatOptions } from "./heartbeat";
export { NodeServer, type NodeServerOptions } from "./node-server";
export {
  bearerMatches,
  CLUSTER_PATH,
  NODE_PATH,
  type NodeReport,
} from "./protocol";
export { type KnownNode, NodeRegistry, type RegistryEvents } from "./registry";
export {
  type Fetch,
  NodeRefused,
  NodeUnreachable,
  RemoteNode,
  type RemoteNodeOptions,
  RemoteSession,
} from "./remote-host";
