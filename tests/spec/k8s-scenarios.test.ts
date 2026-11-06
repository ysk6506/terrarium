/**
 * The five "컨테이너(쿠버네티스)" sheets tell a careful operator from a careless one (REQ-096). Scripted agents that need
 * no model work the way an operator does: restart a kubelet, read the log and restart the rollout, make room, clean a
 * disk and uncordon, or watch what the cluster heals by itself. The sheet must pay the right move nearly in full, pay the
 * same move less when it comes late, take points back from a move that makes it worse, and give nothing to an agent that
 * does nothing or only guesses. Where the cluster heals by itself, its recovery is not the agent's.
 */
import {
  ALL_SCENARIO_TEMPLATES,
  K8S_TEMPLATES,
  type ScenarioDoc,
  validateScenario,
} from "@terrarium/core/scenario";
import { calibrate, Session } from "@terrarium/core/session";
import { DEFAULT_SHAPE, generateShaped } from "@terrarium/core/sources/worldgen";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { k8sLab } from "../../packages/core/src/world/test-support/k8s-lab";

type Run = Session;

const CASES: ReadonlyArray<readonly [string, () => Blueprint]> = [
  ["k8s-worker-down", () => k8sLab()],
  ["k8s-crashloop", () => k8sLab()],
  ["k8s-etcd-quorum", () => k8sLab()],
  ["k8s-pending", () => k8sLab({ webReplicas: 6, webMilli: 1200 })],
  ["k8s-disk-pressure", () => generateShaped({ ...DEFAULT_SHAPE, servers: 48 }).blueprint],
];

function sheet(id: string, make: () => Blueprint) {
  const blueprint = make();
  const index = new BlueprintIndex(blueprint);
  const t = K8S_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return { scenario: t.build(index, "lab"), index, blueprint };
}

const open = (scenario: ScenarioDoc, blueprint: Blueprint): Run => {
  const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
  session.start();
  return session;
};

const answer = (scenario: ScenarioDoc) => {
  const d = scenario.expectations.find((e) => e.kind === "diagnosis") as unknown as {
    rootCause: string[];
    faultType: string[];
  };
  return { rootCause: d.rootCause[0] as string, faultType: d.faultType[0] as string };
};
const report = (run: Run, scenario: ScenarioDoc) =>
  run.call("submit_diagnosis", { ...answer(scenario), summary: "원인과 조치 보고" });
const score = (run: Run) => run.finish().score;
const sh = (run: Run, host: string, cmd: string) => run.call("run_command", { host, cmd });

/** The big old logs a full disk holds, found and removed the way an operator does. */
function cleanDisk(run: Run, host: string): void {
  const found = sh(run, host, "find /var/log -size +1G").data as { output: string };
  sh(run, host, `rm ${found.output.split("\n").join(" ")}`);
}

/** The look an operator takes before touching anything. */
function lookAround(run: Run): void {
  run.call("list_alarms", {});
  run.call("list_services", {});
  run.call("kubectl_get", { kind: "pods" });
}

/** What fixes each sheet, as the operator does it. */
function fix(run: Run, id: string): void {
  switch (id) {
    case "k8s-worker-down":
      sh(run, "vm-main-w1", "systemctl restart kubelet");
      return;
    case "k8s-crashloop": {
      const pods = run.call("kubectl_get", { kind: "pods" }).data as {
        clusters: Array<{ items: Array<{ name: string; deployment: string }> }>;
      };
      const crash = pods.clusters[0]?.items.find((p) => p.deployment === "web");
      if (crash) run.call("kubectl_logs", { pod: crash.name });
      run.call("kubectl_rollout_restart", { workload: "web" });
      return;
    }
    case "k8s-pending":
      run.call("kubectl_scale", { workload: "report", replicas: 0 });
      return;
    case "k8s-disk-pressure":
      cleanDisk(run, "vm-main-w1");
      run.call("kubectl_uncordon", { node: "main-w1" });
      return;
    default:
  }
}

describe("every container sheet is valid and cannot be passed by not knowing [REQ-096]", () => {
  for (const [id, make] of CASES) {
    test(`${id}: valid, idle and guess earn nothing, knowing the answer is not enough`, () => {
      const s = sheet(id, make);
      expect(
        validateScenario(s.scenario, { index: s.index, catalog: undefined as never }).filter(
          (i) => i.severity === "error",
        ),
      ).toEqual([]);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      const total = (r: string) => c.runs.find((x) => x.id === r)?.total ?? -1;
      expect(total("idle")).toBe(0);
      expect(total("guess")).toBe(0);
      expect(c.runs.some((r) => r.id !== "knows" && r.passed)).toBe(false);
      expect(c.diagnosisOnly).toBeLessThan(60);
      expect(c.diagnosisOnly - c.floor).toBeGreaterThanOrEqual(30);
    });
  }

  test("the five are in the list of all templates, and a world without a cluster says why", () => {
    for (const t of K8S_TEMPLATES) expect(ALL_SCENARIO_TEMPLATES).toContain(t);
    expect(K8S_TEMPLATES).toHaveLength(5);
    const none = new BlueprintIndex({ ...k8sLab(), entities: [], links: [] });
    for (const t of K8S_TEMPLATES) expect(t.unavailable(none)).toMatch(/쿠버네티스/);
  });

  test("a sheet is only offered where the cluster has the nodes it needs", () => {
    const small = new BlueprintIndex(k8sLab({ workers: 2 }));
    const byId = (id: string) =>
      K8S_TEMPLATES.find((t) => t.id === id) as (typeof K8S_TEMPLATES)[number];
    expect(byId("k8s-pending").unavailable(small)).toMatch(/워커 노드가 3개/);
    expect(byId("k8s-crashloop").unavailable(small)).toBeUndefined();
  });
});

describe("recovery first beats cause first beats doing nothing [REQ-096] [REQ-088]", () => {
  for (const id of ["k8s-crashloop", "k8s-pending"]) {
    const make = CASES.find(([x]) => x === id)?.[1] as () => Blueprint;
    test(`${id}: the fix at once > the same fix after a long look > nothing`, () => {
      const s = sheet(id, make);
      const early = open(s.scenario, s.blueprint);
      lookAround(early);
      fix(early, id);
      early.call("wait", { seconds: 240 });
      report(early, s.scenario);
      const late = open(s.scenario, s.blueprint);
      for (let i = 0; i < 3; i++) lookAround(late);
      late.call("wait", { seconds: 900 });
      fix(late, id);
      late.call("wait", { seconds: 240 });
      report(late, s.scenario);
      const none = open(s.scenario, s.blueprint);
      none.call("wait", { seconds: 900 });
      const [a, b, c] = [score(early).total ?? 0, score(late).total ?? 0, score(none).total ?? 0];
      expect(a, `${id}: early`).toBeGreaterThan(b);
      expect(b, `${id}: late`).toBeGreaterThan(c);
      expect(c).toBe(0);
      expect(a).toBeGreaterThanOrEqual(75);
    });
  }

  test("k8s-crashloop: deleting pods or draining nodes takes points back and does not recover", () => {
    const s = sheet("k8s-crashloop", () => k8sLab());
    const right = open(s.scenario, s.blueprint);
    fix(right, "k8s-crashloop");
    right.call("wait", { seconds: 240 });
    report(right, s.scenario);
    const wrong = open(s.scenario, s.blueprint);
    wrong.call("kubectl_drain", { node: "main-w1" });
    wrong.call("kubectl_scale", { workload: "web", replicas: 8 });
    wrong.call("wait", { seconds: 240 });
    report(wrong, s.scenario);
    expect(score(wrong).total ?? 0).toBeLessThan(score(right).total ?? 0);
    expect(score(wrong).recovery?.recovered).toBe(false);
  });
});

describe("what the cluster heals by itself is not the agent's recovery [REQ-096] [REQ-088]", () => {
  test("a worker down: watching for five minutes earns the report, and the result says the cluster did it", () => {
    const s = sheet("k8s-worker-down", () => k8sLab());
    const run = open(s.scenario, s.blueprint);
    lookAround(run);
    run.call("kubectl_describe", { kind: "node", name: "main-w1" });
    run.call("wait", { seconds: 420 });
    report(run, s.scenario);
    const result = run.finish();
    const recovery = result.score.recovery;
    expect(recovery?.recovered).toBe(true);
    expect(recovery?.byCluster).toBe(true);
    expect(recovery?.byAgent).toBe(false);
    expect(result.score.total).toBeLessThanOrEqual(30);
    const axes = result.score.items.filter((i) => i.id.startsWith("recovery"));
    expect(axes.find((i) => i.id === "recovery_time")?.detail).toContain("클러스터가 알아서");
  });

  test("a worker down: restarting the kubelet at once is the agent's recovery and scores clearly more", () => {
    const s = sheet("k8s-worker-down", () => k8sLab());
    const quick = open(s.scenario, s.blueprint);
    lookAround(quick);
    fix(quick, "k8s-worker-down");
    quick.call("wait", { seconds: 60 });
    report(quick, s.scenario);
    const watcher = open(s.scenario, s.blueprint);
    watcher.call("wait", { seconds: 420 });
    report(watcher, s.scenario);
    expect(score(quick).recovery?.byAgent).toBe(true);
    expect(score(quick).total ?? 0).toBeGreaterThan(score(watcher).total ?? 0);
  });

  test("a disk-pressure node: the evicted pods wait until the disk is clean and the node uncordoned", () => {
    const world = () => generateShaped({ ...DEFAULT_SHAPE, servers: 48 }).blueprint;
    const s = sheet("k8s-disk-pressure", world);
    const index = new BlueprintIndex(s.blueprint);
    const node = index.entity("k8s-iap-w1");
    const vm = index.outgoing(node.id, "hosted_on")[0]?.to as string;
    const done = open(s.scenario, s.blueprint);
    lookAround(done);
    cleanDisk(done, vm);
    done.call("kubectl_uncordon", { node: node.id });
    done.call("wait", { seconds: 120 });
    report(done, s.scenario);
    const half = open(s.scenario, s.blueprint);
    half.call("wait", { seconds: 600 });
    report(half, s.scenario);
    expect(score(done).recovery?.byAgent).toBe(true);
    expect(score(done).total ?? 0).toBeGreaterThan(score(half).total ?? 0);
    expect(score(half).total ?? 0).toBeLessThanOrEqual(30);
  });
});

describe("the cause of every sheet is reached with the tools a real team has [REQ-096] [REQ-080]", () => {
  test("from the alarms and the service list, with common tools", () => {
    for (const [id, make] of CASES) {
      const s = sheet(id, make);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.commonReach?.reached, id).toBe(true);
    }
  });
});

describe("each sheet has a way back that is the cluster's own [REQ-096] [REQ-088]", () => {
  const WAYS: Readonly<Record<string, string>> = {
    "k8s-worker-down": "run_command",
    "k8s-crashloop": "kubectl_rollout_restart",
    "k8s-etcd-quorum": "run_command",
    "k8s-pending": "kubectl_scale",
    "k8s-disk-pressure": "run_command",
  };
  for (const [id, how] of Object.entries(WAYS)) {
    test(`${id}: ${how}`, () => {
      const make = CASES.find(([x]) => x === id)?.[1] as () => Blueprint;
      const s = sheet(id, make);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.recoveryPath, id).toMatchObject({ applicable: true, ok: true });
      // a rollout restart also puts new pods where there is room, so it is a true way back for a stopped worker and an evicting one
      expect(
        ["k8s-worker-down", "k8s-disk-pressure"].includes(id)
          ? ["kubectl_rollout_restart", how]
          : [how],
        id,
      ).toContain(c.recoveryPath?.how);
    });
  }
});
