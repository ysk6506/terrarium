/**
 * Drives one experiment over Terrarium's HTTP API against a real harness and prints the outcome.
 * Usage: pnpm tsx tests/e2e/harness/drive.ts <connector> <name> '<config json>' [agentId]
 * Env: TERRARIUM_URL (default http://127.0.0.1:8787), TERRARIUM_USER (default haneul).
 * It makes a small world and the "냉방기 정지" scenario the first time, and reuses a connection of that name.
 */
export {};

const base = process.env.TERRARIUM_URL ?? "http://127.0.0.1:8787";
const user = process.env.TERRARIUM_USER ?? "haneul";
const out = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

// biome-ignore lint/suspicious/noExplicitAny: ADR-0148, a throwaway driver reads the API's JSON loosely
type Json = any;

async function call(method: string, url: string, payload?: object): Promise<Json> {
  const r = await fetch(base + url, {
    method,
    headers: { "x-terrarium-user": user, "content-type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

const TOOLS = [
  "list_alarms",
  "list_entities",
  "get_entity",
  "get_topology",
  "get_impact",
  "query_metrics",
  "facility_status",
  "set_cooling_setpoint",
  "restart_cooling_unit",
  "reset_breaker",
  "power_server",
  "wait",
  "submit_diagnosis",
];

async function scenarioOf(): Promise<{ worldId: string; scenarioId: string }> {
  const found = (await call("GET", "/api/scenarios")).body as Json[];
  const existing = found.find((s) => s.name === "냉방기 정지");
  if (existing) return { worldId: existing.worldId, scenarioId: existing.id };
  const generated = await call("POST", "/api/worlds/generate", {
    spec: {
      site: "cheonan",
      seed: 2,
      buildings: 1,
      floors: 1,
      roomsPerFloor: 1,
      rows: 2,
      racksPerRow: 3,
      fill: 0.5,
      gpuShare: 0,
      containment: "hot",
      coolingRedundancy: "N+1",
      powerRedundancy: "N",
      vmsPerHost: 0,
    },
  });
  const world = await call("POST", "/api/worlds", {
    name: "e2e 홀",
    blueprint: generated.body.world.blueprint,
  });
  const scenario = await call("POST", "/api/scenarios", {
    worldId: world.body.world.id,
    templateId: "cooling-failure",
  });
  return { worldId: world.body.world.id, scenarioId: scenario.body.scenario.id };
}

const [connector, name, config, agentArg] = process.argv.slice(2);
if (!connector || !name || !config) {
  out("usage: drive.ts <connector> <name> '<config json>' [agentId]");
  process.exit(2);
}
const { worldId, scenarioId } = await scenarioOf();
const checked = await call("POST", "/api/connections/check", {
  connector,
  config: JSON.parse(config),
});
out(`check: ${JSON.stringify(checked.body)}`);
if (!checked.body.ok) process.exit(1);
const known = ((await call("GET", "/api/connections")).body as Json[]).find((c) => c.name === name);
const made =
  known ??
  (await call("POST", "/api/connections", { connector, name, config: JSON.parse(config) })).body;
const agentId = agentArg ?? checked.body.agents[0]?.id;
const created = await call("POST", "/api/experiments", {
  name: `e2e ${name}`,
  recipe: { worldId, scenarioId, harnessId: made.id, agentId, tools: TOOLS, seeds: [1] },
});
const id = created.body.experiment.id as string;
out(`experiment: ${id} (connection ${made.id}, agent ${agentId})`);
for (let i = 0; i < 900; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const e = (await call("GET", `/api/experiments/${id}`)).body;
  if (!["completed", "failed", "cancelled"].includes(e.status)) continue;
  const run = e.runs[0];
  const detail = (await call("GET", `/api/runs/${run.id}`)).body;
  out(`status: ${e.status}, run ${run.id}, score ${run.score}, passed ${run.passed}`);
  for (const item of detail.run.result?.score.items ?? [])
    out(`  ${item.id}: ${item.verdict} ${item.points}/${item.max}`);
  out(`  tools: ${JSON.stringify(detail.analysis?.behaviour?.toolUse)}`);
  out(`  page: ${base}/experiments/${id}`);
  process.exit(e.status === "completed" ? 0 : 1);
}
out("timed out waiting for the experiment");
process.exit(1);
