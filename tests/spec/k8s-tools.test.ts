/**
 * The kubectl tools of an agent (REQ-096): what each one reads and does, what it refuses in words, and that the API
 * being down is a conflict for every one of them.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { k8sLab } from "../../packages/core/src/world/test-support/k8s-lab";

function lab(second = false) {
  const world = World.fromBlueprint(k8sLab({ second }), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const box = new Toolbox(TOOL_NAMES);
  const raw = (tool: string, args: Record<string, unknown> = {}) =>
    box.call(tool, args, { world, facades: {} as Facades });
  const data = (tool: string, args: Record<string, unknown> = {}) => {
    const r = raw(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const inject = (type: FaultType, target: string) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params: {} } },
      "scenario",
    );
  return { world, physics, raw, data, inject };
}

describe("kubectl_get reads nodes, pods and deployments of each cluster [REQ-096]", () => {
  test("nodes come with their status and role, pods with their words, deployments with the desired count", () => {
    const { data } = lab();
    const nodes = data("kubectl_get", { kind: "nodes" }).clusters[0];
    expect(nodes).toMatchObject({ cluster: "k8s-main", apiUp: true });
    expect(nodes.items).toHaveLength(6);
    expect(nodes.items[0]).toMatchObject({ status: "Ready", role: expect.any(String) });
    const pods = data("kubectl_get", { kind: "pods" }).clusters[0];
    expect(pods.items).toHaveLength(6);
    expect(pods.items[0]).toMatchObject({ ready: "1/1", status: "Running", restarts: 0 });
    const deploys = data("kubectl_get", { kind: "deployments" }).clusters[0].items;
    expect(
      deploys.map((d: { name: string; desired: number }) => [d.name, d.desired]).sort(),
    ).toEqual([
      ["report", 2],
      ["web", 4],
    ]);
  });

  test("a namespace narrows the pods, and a cluster can be named, and every cluster is listed when none is", () => {
    const { data, raw } = lab(true);
    expect(data("kubectl_get", { kind: "pods", namespace: "nothing" }).clusters[0].items).toEqual(
      [],
    );
    expect(data("kubectl_get", { kind: "pods" }).clusters).toHaveLength(2);
    expect(
      data("kubectl_get", { kind: "nodes", cluster: "k8s-b" }).clusters.map(
        (c: { cluster: string }) => c.cluster,
      ),
    ).toEqual(["k8s-b"]);
    expect(raw("kubectl_get", { kind: "nodes", cluster: "svc-portal" }).error).toContain(
      "클러스터가 아니에요",
    );
    expect(raw("kubectl_get", { kind: "secrets" }).error).toContain("nodes, pods, deployments");
  });

  test("a cluster whose API is down refuses with the client's words", () => {
    const up = lab();
    const down = lab();
    for (const cp of ["main-cp1", "main-cp2", "main-cp3"])
      down.inject("k8s_control_plane_down", cp);
    down.physics.run(120);
    const r = down.raw("kubectl_get", { kind: "nodes" });
    expect(r.error).toContain("The connection to the server was refused");
    expect(up.raw("kubectl_get", { kind: "nodes" }).error).toBeUndefined();
  });
});

describe("kubectl_describe and kubectl_logs read one thing by name [REQ-096]", () => {
  test("a node is described by id or by name, and a name that is not there is refused", () => {
    const { data, raw } = lab();
    expect(data("kubectl_describe", { kind: "node", name: "main-w1" }).output).toContain("main-w1");
    expect(data("kubectl_describe", { kind: "node", name: "main-w1" })).toEqual(
      data("kubectl_describe", { kind: "node", name: "main-w1" }),
    );
    expect(raw("kubectl_describe", { kind: "node", name: "zz" }).error).toContain(
      "'zz'라는 노드는 없어요",
    );
  });

  test("a deployment shows its replicas, requests and revision", () => {
    const { data, raw } = lab();
    const out = data("kubectl_describe", { kind: "deployment", name: "web" }).output as string;
    expect(out).toContain("Name:        web");
    expect(out).toContain("Replicas:    4 desired | 4 total | 4 available");
    expect(out).toMatch(/Requests: {4}cpu 500m, memory \d+Mi per pod/);
    expect(out).toContain("Revision:");
    expect(raw("kubectl_describe", { kind: "service", name: "web" }).error).toContain(
      "node, pod, deployment",
    );
  });

  test("a pod is described and its logs read by name, and a pod that is not there is refused", () => {
    const { data, raw, world } = lab();
    const pod = world.stateAs("web", "k8s_workload").pods[0]?.name as string;
    expect(data("kubectl_describe", { kind: "pod", name: pod }).output).toContain(pod);
    const logs = data("kubectl_logs", { pod, tail: 5 });
    expect(logs.pod).toBe(pod);
    expect(typeof logs.output).toBe("string");
    expect(raw("kubectl_describe", { kind: "pod", name: "nope" }).error).toContain(
      "'nope' 파드는 없어요",
    );
    expect(raw("kubectl_logs", { pod: "nope" }).error).toContain("'nope' 파드는 없어요");
  });
});

describe("the kubectl actions change the cluster and say what will happen [REQ-096]", () => {
  test("scale sets the desired count and reports from and to", () => {
    const { data, physics, world } = lab();
    const r = data("kubectl_scale", { workload: "web", replicas: 6 });
    expect(r).toMatchObject({ workload: "web", from: 4, to: 6 });
    physics.run(120);
    expect(world.stateAs("web", "k8s_workload").desired).toBe(6);
  });

  test("a rollout restart bumps the revision, and a deleted pod is replaced by the workload", () => {
    const { data, world, physics } = lab();
    const before = world.stateAs("web", "k8s_workload").gen;
    const r = data("kubectl_rollout_restart", { workload: "web" });
    expect(r.revision).toBe(before + 1);
    expect(r.note).toContain("하나씩 새 것으로");
    physics.run(300);
    const pod = world.stateAs("report", "k8s_workload").pods[0]?.name as string;
    const del = data("kubectl_delete_pod", { pod });
    expect(del).toMatchObject({ deleted: pod, deployment: "report" });
  });

  test("cordon, uncordon and drain say what they do and the node's status follows", () => {
    const { data, physics } = lab();
    expect(data("kubectl_cordon", { node: "main-w1" })).toMatchObject({
      status: "Ready,SchedulingDisabled",
    });
    expect(data("kubectl_cordon", { node: "main-w1" }).note).toContain("새 파드가 오지 않아요");
    expect(data("kubectl_uncordon", { node: "main-w1" })).toMatchObject({ status: "Ready" });
    expect(data("kubectl_uncordon", { node: "main-w1" }).note).toContain("다시 새 파드를 받아요");
    const drained = data("kubectl_drain", { node: "main-w2" });
    expect(drained.note).toContain("파드를 내보냈어요");
    physics.run(60);
  });

  test("a workload or node that does not exist is refused by name", () => {
    const { raw } = lab();
    expect(raw("kubectl_scale", { workload: "nope", replicas: 2 }).error).toContain(
      "'nope'라는 워크로드는 없어요",
    );
    expect(raw("kubectl_cordon", { node: "nope" }).error).toContain("'nope'라는 노드는 없어요");
  });
});
