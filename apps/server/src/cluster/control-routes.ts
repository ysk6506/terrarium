/**
 * The control plane's cluster endpoints (ADR-0032): nodes say hello here, operators list them, and
 * autoscalers read the load as Prometheus metrics. All of it needs the cluster token.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bearerMatches, CLUSTER_PATH, isNodeReport } from "./protocol";
import type { NodeRegistry } from "./registry";

export interface ControlDeps {
  readonly registry: NodeRegistry;
  readonly token: string;
  readonly counts: () => { readonly running: number; readonly queued: number };
  /** Sessions this process can run itself (0 for a pure control plane). */
  readonly localSlots: number;
  /** Slots one new worker brings: how many nodes are wanted for the work waiting. */
  readonly slotsPerWorker: () => number;
  /** More metrics, in the same text format, added after the load (the audit log's counters). */
  readonly extraMetrics?: () => string;
  /** Told when the set of usable nodes changes, so queued runs can start. */
  readonly onChange?: () => void;
}

export interface Load {
  readonly running: number;
  readonly queued: number;
  readonly capacity: number;
  readonly nodes: number;
  readonly draining: number;
  readonly utilization: number;
  /** Workers needed to hold everything running and waiting. Scale to this, not to CPU. */
  readonly nodesWanted: number;
}

export function loadOf(deps: ControlDeps): Load {
  const { running, queued } = deps.counts();
  const live = deps.registry.list();
  const capacity = deps.localSlots + deps.registry.capacity;
  const demand = running + queued;
  return {
    running,
    queued,
    capacity,
    nodes: live.length,
    draining: live.filter((n) => n.draining).length,
    utilization: capacity === 0 ? (demand > 0 ? 1 : 0) : Math.min(1, running / capacity),
    nodesWanted: Math.max(
      0,
      Math.ceil((demand - deps.localSlots) / Math.max(1, deps.slotsPerWorker())),
    ),
  };
}

const METRICS: ReadonlyArray<readonly [keyof Load, string, string]> = [
  ["running", "terrarium_runs_running", "Runs executing now."],
  ["queued", "terrarium_runs_queued", "Runs waiting for a free session slot."],
  [
    "capacity",
    "terrarium_session_capacity",
    "Session slots across the control plane and live nodes.",
  ],
  ["nodes", "terrarium_nodes", "Worker nodes that are alive."],
  ["draining", "terrarium_nodes_draining", "Worker nodes finishing their sessions before leaving."],
  ["utilization", "terrarium_session_utilization", "Running runs divided by capacity, 0 to 1."],
  ["nodesWanted", "terrarium_nodes_wanted", "Worker nodes needed for all running and queued runs."],
];

/** Prometheus text exposition of the load. */
export function metricsText(load: Load): string {
  return `${METRICS.map(
    ([key, name, help]) => `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${load[key]}`,
  ).join("\n")}\n`;
}

export function registerControl(app: FastifyInstance, deps: ControlDeps): void {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!bearerMatches(req.headers.authorization, deps.token))
      return reply
        .code(401)
        .send({ error: { message: "토큰이 맞지 않아요", code: "unauthorized" } });
    return undefined;
  };
  app.post(`${CLUSTER_PATH}/heartbeat`, { preHandler: guard }, async (req, reply) => {
    if (!isNodeReport(req.body))
      return reply
        .code(400)
        .send({ error: { message: "노드 보고가 올바르지 않아요", code: "invalid_value" } });
    if (deps.registry.beat(req.body)) return { ok: true };
    return reply
      .code(400)
      .send({ error: { message: "노드 주소가 올바르지 않아요", code: "invalid_value" } });
  });
  app.post(`${CLUSTER_PATH}/leave`, { preHandler: guard }, async (req) => {
    const id = (req.body as { id?: unknown } | null)?.id;
    if (typeof id === "string") deps.registry.leave(id);
    return { ok: true };
  });
  app.get(`${CLUSTER_PATH}/nodes`, { preHandler: guard }, async () => ({
    nodes: deps.registry.list(),
    load: loadOf(deps),
  }));
  app.get("/metrics", { preHandler: guard }, async (_req, reply) =>
    reply
      .type("text/plain; version=0.0.4")
      .send(`${metricsText(loadOf(deps))}${deps.extraMetrics?.() ?? ""}`),
  );
}
