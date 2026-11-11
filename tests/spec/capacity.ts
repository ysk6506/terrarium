/**
 * Capacity measurement (REQ-032, REQ-042): how many runs at once one process holds, and what it costs.
 * Not a test (it takes minutes): run it, read the numbers, put them in docs/design-docs/capacity.md.
 *
 *   npx tsx tests/spec/capacity.ts --concurrency 256 --think 300 --threads 1 --total 512
 *
 * The agent is the built-in "triage" agent slowed down the way a model is: it waits `think` ms before
 * every tool call, because that waiting is what real runs mostly do. The store is the real SQLite file.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { AgentRunOutcome, AgentRunRequest, HarnessPort } from "@terrarium/core/experiments";
import { DEFAULT_CAMPUS, generateCampus, SITE_CAMPUS_MIX } from "@terrarium/core/sources/worldgen";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { buildAdapters, parseConfig, ScriptedHarness } from "../../apps/server/src/adapters";
import { Platform, WorkerHost } from "../../apps/server/src/runtime";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const concurrency = arg("concurrency", 64);
const thinkMs = arg("think", 300);
const threads = arg("threads", 1);
const total = arg("total", concurrency * 2);
const users = arg("users", 8);
/** A generated world with about N racks (real sites have hundreds); the default is a small one. */
const racks = arg("racks", 8);
/** A generated campus of this site (cheonan, suwon, giheung, hwaseong, ...) instead of a hall of racks. */
const campusSite = (() => {
  const i = process.argv.indexOf("--campus");
  return i > 0 ? (process.argv[i + 1] as keyof typeof SITE_CAMPUS_MIX) : undefined;
})();
/** How many different worlds the runs are spread over (each has its own warm-up and its own memory). */
const worldCount = arg("worlds", 1);

/** The built-in agent, but every tool call waits first, as a model's turn would. */
class ThinkingHarness implements HarnessPort {
  readonly info;
  readonly callMs: number[] = [];
  private readonly inner = new ScriptedHarness("slow", "느린 기준 에이전트");

  constructor() {
    this.info = { ...this.inner.info, id: "slow", name: "느린 기준 에이전트" };
  }

  agents() {
    return this.inner.agents();
  }

  run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const tools = req.tools;
    const slowed = {
      ...tools,
      specs: tools.specs,
      call: async (name: string, args: Record<string, unknown>) => {
        await new Promise((r) => setTimeout(r, thinkMs));
        const started = performance.now();
        const result = await tools.call(name, args);
        this.callMs.push(performance.now() - started);
        return result;
      },
    };
    return this.inner.run({ ...req, tools: slowed });
  }
}

const quantile = (xs: number[], q: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
};

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "terrarium-capacity-"));
  const config = parseConfig({ dataDir: dir });
  const adapters = buildAdapters(config, { env: {} });
  const harness = new ThinkingHarness();
  const host = new WorkerHost({ size: threads });
  const platform = new Platform({
    adapters: { ...adapters, harnesses: [harness] },
    host,
    limits: { maxRunning: concurrency, perUser: concurrency, perHarness: concurrency },
    graceMs: 200,
  });
  await platform.start();
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const viewerOf = (i: number) => {
    const name = `user${i % users}`;
    return { id: name, name, groups: [], roles: ["user" as const], source: "proxy" as const };
  };
  const first = viewerOf(0);
  const side = Math.ceil(Math.sqrt(racks / 2));
  const targets: Array<{ worldId: string; scenarioId: string }> = [];
  for (let w = 0; w < worldCount; w++) {
    const { world } = campusSite
      ? await platform.worlds.create(first, {
          name: `부하 캠퍼스 ${w}`,
          blueprint: generateCampus({
            ...DEFAULT_CAMPUS,
            ...SITE_CAMPUS_MIX[campusSite],
            site: campusSite,
            seed: w + 1,
          }).blueprint,
        })
      : await platform.worlds.generate(first, {
          spec: {
            site: "cheonan",
            seed: w + 1,
            buildings: 1,
            floors: 1,
            roomsPerFloor: 2,
            rows: side,
            racksPerRow: side,
            fill: 0.6,
            gpuShare: 0.1,
            containment: "hot",
            coolingRedundancy: "N+1",
            powerRedundancy: "2N",
            vmsPerHost: 2,
          },
        });
    const { scenario } = await platform.scenarios.create(first, {
      worldId: world.id,
      templateId: "cooling-failure",
    });
    targets.push({ worldId: world.id, scenarioId: scenario.id });
  }
  let peakRunning = 0;
  let peakRss = 0;
  let peakMainHeap = 0;
  let peakWorkerHeap = 0;
  const sampler = setInterval(() => {
    peakRunning = Math.max(peakRunning, platform.dispatcher.counts.running);
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakMainHeap = Math.max(peakMainHeap, m.heapUsed);
  }, 50);
  const heapSampler = setInterval(() => {
    void host.threadHeapMb().then((mb) => {
      peakWorkerHeap = Math.max(
        peakWorkerHeap,
        mb.reduce((a, b) => a + b, 0),
      );
    });
  }, 500);

  const started = performance.now();
  const ids: Array<{ viewer: ReturnType<typeof viewerOf>; id: string }> = [];
  for (let i = 0, left = total; left > 0; i++, left -= 20) {
    const count = Math.min(20, left);
    const viewer = viewerOf(i);
    const target = targets[i % targets.length] as { worldId: string; scenarioId: string };
    const made = await platform.experiments.create(viewer, {
      name: `부하 ${i}`,
      recipe: {
        worldId: target.worldId,
        scenarioId: target.scenarioId,
        harnessId: "slow",
        agentId: "triage",
        tools: [...DEFAULT_TOOLSET],
        seeds: Array.from({ length: count }, (_, k) => i * 20 + k + 1),
      },
    });
    ids.push({ viewer, id: made.experiment.id });
  }
  let finished = 0;
  let failed = 0;
  for (;;) {
    finished = 0;
    failed = 0;
    for (const { viewer, id } of ids) {
      const v = await platform.experiments.view(viewer, id);
      finished += v.progress.finished;
      failed += v.progress.failed ?? 0;
    }
    if (finished >= total) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const seconds = (performance.now() - started) / 1000;
  clearInterval(sampler);
  clearInterval(heapSampler);
  lag.disable();
  const dbBytes = (() => {
    try {
      return statSync(path.join(dir, "terrarium.db")).size;
    } catch {
      return 0;
    }
  })();
  const out = {
    concurrency,
    worlds: worldCount,
    ...(campusSite ? { campus: campusSite } : { racks }),
    thinkMs,
    threads,
    total,
    seconds: Number(seconds.toFixed(1)),
    runsPerSecond: Number((total / seconds).toFixed(2)),
    peakRunning,
    failed,
    callMs: {
      p50: Number(quantile(harness.callMs, 0.5).toFixed(1)),
      p99: Number(quantile(harness.callMs, 0.99).toFixed(1)),
    },
    eventLoopLagMs: {
      p50: Number((lag.percentile(50) / 1e6).toFixed(1)),
      p99: Number((lag.percentile(99) / 1e6).toFixed(1)),
      max: Number((lag.max / 1e6).toFixed(1)),
    },
    peakRssMb: Math.round(peakRss / 1048576),
    peakMainHeapMb: Math.round(peakMainHeap / 1048576),
    peakWorkerHeapMb: peakWorkerHeap,
    dbKb: Math.round(dbBytes / 1024),
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
  await platform.stop();
  await host.close();
  await adapters.close();
  rmSync(dir, { recursive: true, force: true });
}

await main();
process.exit(0);
