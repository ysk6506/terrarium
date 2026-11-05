/**
 * Scale-out under load (REQ-042): a control plane and N worker nodes, each its own OS process, all
 * talking over HTTP like a real deployment (this script is only the client that drives it). Runs many experiments on several worlds at
 * once, then reports how fast they finished and how the sessions spread over the nodes.
 *
 *   npx tsx tests/spec/cluster-load.ts --nodes 2 --threads 1 --worlds 4 --runs 200 --campus cheonan
 *
 * Not a test (it takes minutes). On a machine with fewer cores than threads the numbers show that
 * the cluster works and shares the load, not how it scales; that needs a machine per node.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_CAMPUS, generateCampus, SITE_CAMPUS_MIX } from "@terrarium/core/sources/worldgen";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const nodes = arg("nodes", 2);
const threads = arg("threads", 1);
const worldCount = arg("worlds", 4);
const runs = arg("runs", 200);
const campus = (() => {
  const i = process.argv.indexOf("--campus");
  return (i > 0 ? process.argv[i + 1] : "cheonan") as keyof typeof SITE_CAMPUS_MIX;
})();

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-cluster-"));
const TOKEN = "c".repeat(32);
const auth = { authorization: `Bearer ${TOKEN}` };

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

function configFile(name: string, body: object): string {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(
    file,
    JSON.stringify({ host: "127.0.0.1", dataDir: path.join(dir, name), ...body }),
  );
  return file;
}

const cluster = (extra: object) => ({
  tokenEnv: "TERRARIUM_LOAD_TOKEN",
  heartbeatSeconds: 1,
  nodeTtlSeconds: 8,
  drainSeconds: 5,
  ...extra,
});

async function main() {
  const controlPort = await freePort();
  const launch = (file: string): ChildProcess =>
    spawn(process.execPath, ["--import", "tsx", "apps/server/src/main.ts"], {
      env: { ...process.env, TERRARIUM_CONFIG: file, TERRARIUM_LOAD_TOKEN: TOKEN },
      stdio: ["ignore", "ignore", "inherit"],
    });
  const control = {
    url: `http://127.0.0.1:${controlPort}`,
    process: launch(
      configFile("control", {
        port: controlPort,
        limits: { maxRunning: 512, perUser: 512, perHarness: 512 },
        cluster: cluster({ role: "control" }),
      }),
    ),
  };
  const children: ChildProcess[] = [];
  for (let n = 0; n < nodes; n++) {
    const port = await freePort();
    const file = configFile(`node${n}`, {
      port,
      workers: threads,
      cluster: cluster({
        role: "worker",
        controlUrl: control.url,
        advertiseUrl: `http://127.0.0.1:${port}`,
        nodeId: `node-${n}`,
      }),
    });
    children.push(launch(file));
  }
  const api = async <T>(method: string, url: string, payload?: object): Promise<T> => {
    const res = await fetch(`${control.url}${url}`, {
      method,
      headers: { "content-type": "application/json", "x-terrarium-user": "load" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    return (await res.json()) as T;
  };
  const listNodes = async () =>
    (
      (await (await fetch(`${control.url}/cluster/v1/nodes`, { headers: auth })).json()) as {
        nodes: Array<{ id: string; slots: number; open?: number }>;
      }
    ).nodes;
  try {
    for (const end = Date.now() + 90_000; (await listNodes().catch(() => [])).length < nodes; ) {
      if (Date.now() > end) throw new Error("워커 노드가 붙지 않았어요");
      await new Promise((r) => setTimeout(r, 250));
    }
    const targets: Array<{ worldId: string; scenarioId: string }> = [];
    for (let w = 0; w < worldCount; w++) {
      const { world } = await api<{ world: { id: string } }>("POST", "/api/worlds", {
        name: `부하 캠퍼스 ${w}`,
        blueprint: generateCampus({
          ...DEFAULT_CAMPUS,
          ...SITE_CAMPUS_MIX[campus],
          site: campus,
          seed: w + 1,
        }).blueprint,
      });
      const { scenario } = await api<{ scenario?: { id: string } }>("POST", "/api/scenarios", {
        worldId: world.id,
        templateId: "cooling-failure",
      });
      if (!scenario) throw new Error("시나리오를 만들지 못했어요");
      targets.push({ worldId: world.id, scenarioId: scenario.id });
    }
    const started = performance.now();
    const ids: string[] = [];
    const perExperiment = 20;
    for (let i = 0, left = runs; left > 0; i++, left -= perExperiment) {
      const target = targets[i % targets.length] as { worldId: string; scenarioId: string };
      const made = await api<{ experiment?: { id: string } }>("POST", "/api/experiments", {
        name: `부하 ${i}`,
        recipe: {
          worldId: target.worldId,
          scenarioId: target.scenarioId,
          harnessId: "builtin",
          agentId: "triage",
          tools: [...DEFAULT_TOOLSET],
          seeds: Array.from({ length: Math.min(perExperiment, left) }, (_, k) => i * 100 + k + 1),
        },
      });
      if (!made.experiment)
        throw new Error(`실험을 만들지 못했어요: ${JSON.stringify(made).slice(0, 300)}`);
      ids.push(made.experiment.id);
    }
    const peakOpen = new Map<string, number>();
    let peakTotal = 0;
    for (;;) {
      let finished = 0;
      let failed = 0;
      const reasons = new Map<string, number>();
      for (const id of ids) {
        const v = await api<{
          progress: { finished: number; failed?: number };
          runs?: Array<{ error?: string }>;
        }>("GET", `/api/experiments/${id}`);
        finished += v.progress.finished;
        failed += v.progress.failed ?? 0;
        for (const r of v.runs ?? [])
          if (r.error) reasons.set(r.error, (reasons.get(r.error) ?? 0) + 1);
      }
      const live = await listNodes();
      let open = 0;
      for (const n of live) {
        open += n.open ?? 0;
        peakOpen.set(n.id, Math.max(peakOpen.get(n.id) ?? 0, n.open ?? 0));
      }
      peakTotal = Math.max(peakTotal, open);
      if (finished >= runs) {
        const seconds = (performance.now() - started) / 1000;
        process.stdout.write(
          `${JSON.stringify({
            nodes,
            threadsPerNode: threads,
            worlds: worldCount,
            campus,
            runs,
            failed,
            seconds: Number(seconds.toFixed(1)),
            runsPerSecond: Number((runs / seconds).toFixed(2)),
            peakOpenSessions: peakTotal,
            peakOpenPerNode: Object.fromEntries(peakOpen),
            ...(reasons.size ? { failures: Object.fromEntries(reasons) } : {}),
          })}\n`,
        );
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    for (const c of [...children, control.process]) c.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
