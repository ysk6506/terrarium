/**
 * Starts Terrarium: config → adapters → session workers → platform → HTTP. Stops cleanly on
 * SIGINT/SIGTERM: running runs end as "the server stopped" (an operation is left running and picked up again from
 * its journal), waiting ones are picked up next start.
 */
import { availableParallelism, hostname } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomToken, wallClockMs } from "@terrarium/core/kernel";
import { buildAdapters, type Config, loadConfig, secret } from "./adapters";
import { ClusterHost, Heartbeat, NodeRegistry, NodeServer, registerControl } from "./cluster";
import { authenticatorOf, buildApp } from "./http";
import { McpGateway } from "./mcp";
import { Platform, type SessionHost, WorkerHost } from "./runtime";

const VERSION = process.env.npm_package_version ?? "dev";
/** How often connections nobody uses are looked for. */
const CONNECTION_SWEEP_MS = 6 * 60 * 60 * 1000;
const WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");

export interface Running {
  /** Where the server listens. */
  readonly url: string;
  stop(): Promise<void>;
}

export interface RunOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: boolean;
}

export async function run(options: RunOptions = {}): Promise<Running> {
  const env = options.env ?? process.env;
  const config = loadConfig(options.env);
  const token = secret(env, config.cluster.tokenEnv);
  return config.cluster.role === "worker" && token
    ? runWorker(config, token)
    : runControl(config, env, token, options.logger ?? true);
}

/** Threads that run sessions here: the setting, or every CPU but one (the main thread keeps HTTP and the scheduler). A pure control plane has none. */
function threadsOf(config: Config, role: "all" | "control" | "worker"): number {
  if (config.workers !== undefined) return config.workers;
  return role === "control" ? 0 : Math.max(1, availableParallelism() - 1);
}

/** Where this process's sessions run: its own threads, plus worker nodes when there is a cluster token. */
interface Placement {
  readonly sessions: SessionHost;
  /** Sessions that can run at once, now. */
  readonly capacity: () => number;
  readonly localSlots: number;
  readonly registry?: NodeRegistry;
  /** Set once the scheduler exists: nodes joining must start queued runs at once. Shared, so every copy of the placement sees it. */
  readonly hooks: { onJoin: () => void };
}

function placementOf(config: Config, token: string | undefined): Placement {
  const c = config.cluster;
  const threads = threadsOf(config, c.role);
  const local = threads > 0 ? new WorkerHost({ size: threads }) : undefined;
  const localSlots = threads * c.sessionsPerThread;
  const hooks = { onJoin: (): void => undefined };
  const placement: Placement = {
    sessions: local as SessionHost,
    capacity: () => localSlots,
    localSlots,
    hooks,
  };
  if (!token) {
    if (!local)
      throw new Error("세션을 돌릴 곳이 없어요: workers를 켜거나 워커 노드를 붙여 주세요");
    return placement;
  }
  const registry = new NodeRegistry(c.nodeTtlSeconds * 1000, { joined: () => hooks.onJoin() });
  const cluster = new ClusterHost({
    registry,
    token,
    ...(local ? { local: { host: local, slots: localSlots } } : {}),
  });
  return { ...placement, sessions: cluster, capacity: () => cluster.capacity, registry };
}

/** The whole platform: HTTP, MCP, scheduler, store. With a cluster token it also takes worker nodes. */
async function runControl(
  config: Config,
  env: NodeJS.ProcessEnv,
  token: string | undefined,
  logger: boolean,
): Promise<Running> {
  // Before anything is opened: a proxy mode with no secret must not start (ADR-0174).
  const authenticator = authenticatorOf(config.identity, env);
  const adapters = buildAdapters(config, { env });
  const c = config.cluster;
  const placement = placementOf(config, token);
  const gateway = new McpGateway(
    config.publicUrl ?? `http://localhost:${config.port}`,
    VERSION,
    (slot) => adapters.secretBox.derive(`slot:${slot}`),
  );
  const platform = new Platform({
    adapters,
    host: placement.sessions,
    gateway,
    limits: config.limits,
    capacity: placement.capacity,
    version: VERSION,
  });
  platform.moss.warm(); // 이끼의 문서 색인을 시작할 때 만들어 둔다 (REQ-103)
  placement.hooks.onJoin = () => platform.dispatcher.wake();
  const app = buildApp({
    platform,
    gateway,
    authenticator,
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
    webDist: WEB_DIST,
    logger,
  });
  const { registry } = placement;
  if (registry && token)
    registerControl(app, {
      registry,
      token,
      counts: () => platform.dispatcher.counts,
      localSlots: placement.localSlots,
      slotsPerWorker: () =>
        registry.averageSlots() ??
        c.nodeSlots ??
        c.sessionsPerThread * Math.max(1, availableParallelism() - 1),
    });
  const sweep = registry && setInterval(() => registry.sweep(), (c.nodeTtlSeconds * 1000) / 4);
  sweep?.unref();
  const recovered = await platform.start();
  // Connections nobody has used for a month are removed (REQ-051); once at start, then every few hours.
  const unused = setInterval(() => void platform.sweepConnections(), CONNECTION_SWEEP_MS);
  unused.unref();
  const url = await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      recovered,
      role: c.role,
      capacity: placement.localSlots,
      harnesses: adapters.harnesses.map((h) => h.info.id),
    },
    "테라리움이 시작됐어요",
  );
  return {
    url,
    async stop() {
      if (sweep) clearInterval(sweep);
      clearInterval(unused);
      await app.close();
      await platform.stop();
      await placement.sessions.close();
      await adapters.close();
    },
  };
}

/** A worker node: runs sessions for a control plane and nothing else. Leaving drains it first. */
async function runWorker(config: Config, token: string): Promise<Running> {
  const c = config.cluster;
  const host = new WorkerHost({ size: threadsOf(config, "worker") });
  const slots = threadsOf(config, "worker") * c.sessionsPerThread;
  const id = c.nodeId ?? `${hostname()}-${randomToken(4)}`;
  const advertised = c.advertiseUrl ?? `http://${hostname()}:${config.port}`;
  const node = new NodeServer({
    host,
    token,
    id,
    url: advertised,
    slots,
    version: VERSION,
    idleMs: c.idleSeconds * 1000,
  });
  node.startReaper();
  const beat = new Heartbeat({
    controlUrl: c.controlUrl as string,
    token,
    report: () => node.report(),
    everyMs: c.heartbeatSeconds * 1000,
    onTrouble: (m) =>
      process.stderr.write(`${m ? `컨트롤에 닿지 않아요: ${m}` : "컨트롤과 다시 닿았어요"}\n`),
  });
  const url = await node.app.listen({ port: config.port, host: config.host });
  beat.start();
  return {
    url,
    async stop() {
      // Say "draining" first so the control plane sends nothing new, then give running sessions time.
      node.drain();
      await beat.beat();
      const until = wallClockMs() + c.drainSeconds * 1000;
      while (node.report().open > 0 && wallClockMs() < until)
        await new Promise((r) => setTimeout(r, 500));
      await beat.stop();
      await node.close();
      await host.close();
    },
  };
}

/* v8 ignore start -- the process entry point: everything it does is run(), tested above */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then(
    (server) => {
      const stop = () => void server.stop().then(() => process.exit(0));
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    },
    (err: unknown) => {
      // The process entry point reports why it could not start.
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
/* v8 ignore stop -- end of the process entry point */
