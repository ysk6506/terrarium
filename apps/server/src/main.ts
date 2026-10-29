/**
 * Starts Terrarium: config → adapters → session workers → platform → HTTP. Stops cleanly on
 * SIGINT/SIGTERM: running runs end as "the server stopped", waiting ones are picked up next start.
 */
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildAdapters, loadConfig } from "./adapters";
import { buildApp } from "./http";
import { McpGateway } from "./mcp";
import { Platform, WorkerHost } from "./runtime";

const VERSION = process.env.npm_package_version ?? "dev";
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
  const config = loadConfig(options.env);
  const adapters = buildAdapters(config, { env: options.env ?? process.env });
  const host = new WorkerHost({ size: config.workers || Math.max(1, availableParallelism() - 1) });
  const gateway = new McpGateway(config.publicUrl ?? `http://localhost:${config.port}`, VERSION);
  const platform = new Platform({
    adapters,
    host,
    gateway,
    limits: config.limits,
    version: VERSION,
  });
  const app = buildApp({
    platform,
    gateway,
    ...(config.identity.header ? { identityHeader: config.identity.header } : {}),
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
    webDist: WEB_DIST,
    logger: options.logger ?? true,
  });
  const recovered = await platform.start();
  const url = await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { recovered, harnesses: adapters.harnesses.map((h) => h.info.id) },
    "테라리움이 시작됐다",
  );
  return {
    url,
    async stop() {
      await app.close();
      await platform.stop();
      await host.close();
      await adapters.close();
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
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
/* v8 ignore stop -- end of the process entry point */
