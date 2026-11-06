/**
 * The container layer (REQ-096, ADR-0107 item 6): what each fault does to the nodes, the pods and the services that
 * lean on a workload, and what the cluster itself does about it (moving the pods of a dead node, backing off a crashing
 * pod, throwing pods out of a node short of disk, moving a VM off a hot host).
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type K8sLabOptions, k8sLab } from "../../packages/core/src/world/test-support/k8s-lab";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const MINUTE = 60;

function lab(options: K8sLabOptions = {}) {
  const world = World.fromBlueprint(k8sLab(options), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(2 * MINUTE);
  const box = new Toolbox(TOOL_NAMES);
  const ctx = { world, facades: {} as Facades };
  const raw = (tool: string, args: Record<string, unknown>) => box.call(tool, args, ctx);
  const call = (tool: string, args: Record<string, unknown>) => {
    const r = raw(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params } },
      "scenario",
    );
  const status = () => world.stateAs("svc-portal", "service").status;
  const pods = (id = "web") => world.stateAs(id, "k8s_workload").pods;
  const sh = (host: string, cmd: string) =>
    call("run_command", { host, cmd }) as { output: string; exitCode: number };
  const fromCluster = () => world.events().filter((e) => e.cause === "cluster");
  return { world, physics, call, raw, inject, status, pods, sh, fromCluster };
}

describe("a healthy cluster [REQ-096]", () => {
  test("the pods stand on the workers, the service is healthy and kubectl says so", () => {
    const { world, call, status, pods } = lab();
    expect(status()).toBe("healthy");
    expect(pods().every((p) => p.phase === "Running" && p.node?.startsWith("main-w"))).toBe(true);
    expect(new Set(pods().map((p) => p.node)).size).toBeGreaterThan(1);
    expect(world.stateAs("k8s-main", "k8s_cluster")).toMatchObject({ apiUp: true, quorum: true });
    const nodes = call("kubectl_get", { kind: "nodes" }).clusters[0].output as string;
    expect(nodes).toMatch(/main-w1\s+Ready\s+worker/);
    expect(nodes).toMatch(/main-cp1\s+Ready\s+control-plane/);
  });
});

describe("a worker node stops [REQ-096]", () => {
  test("NotReady after the grace period, the service slows, the cluster moves the pods after five minutes", () => {
    const { world, physics, inject, status, pods, fromCluster, call } = lab();
    inject("k8s_node_notready", "main-w1");
    physics.run(20);
    expect(world.stateAs("main-w1", "k8s_node").status).toBe("Ready");
    physics.run(40);
    expect(world.stateAs("main-w1", "k8s_node").status).toBe("NotReady");
    expect(status()).toBe("degraded");
    physics.run(3 * MINUTE);
    expect(pods().some((p) => p.node === "main-w1")).toBe(true);
    expect(call("kubectl_get", { kind: "pods" }).clusters[0].output).toMatch(/0\/1\s+Running/);
    physics.run(2 * MINUTE + 30);
    expect(pods().some((p) => p.node === "main-w1")).toBe(false);
    expect(pods().every((p) => p.phase === "Running")).toBe(true);
    expect(status()).toBe("healthy");
    expect(world.stateAs("k8s-main", "k8s_cluster").reschedules).toBeGreaterThan(0);
    expect(fromCluster().some((e) => e.type === "note")).toBe(true);
  });

  test("restarting the kubelet brings the node back before anything is moved", () => {
    const { world, physics, inject, status, sh, fromCluster } = lab();
    inject("k8s_node_notready", "main-w1");
    physics.run(MINUTE);
    expect(sh("vm-main-w1", "systemctl status kubelet").output).toMatch(/failed|inactive/);
    sh("vm-main-w1", "systemctl restart kubelet");
    physics.run(30);
    expect(world.stateAs("main-w1", "k8s_node").status).toBe("Ready");
    expect(status()).toBe("healthy");
    expect(fromCluster()).toHaveLength(0);
  });

  test("a machine that stops makes its node NotReady without a fault of its own", () => {
    const { world, physics, status } = lab();
    world.apply({ type: "power.set", target: "vm-main-w3", on: false }, "scenario");
    physics.run(MINUTE);
    expect(world.stateAs("main-w3", "k8s_node").status).toBe("NotReady");
    expect(status()).toBe("degraded");
  });
});

describe("the control plane [REQ-096]", () => {
  test("one control-plane node: the API stops, running pods keep serving, kubectl is refused, nothing is moved", () => {
    const { world, physics, inject, status, raw, fromCluster, pods } = lab({ controlPlane: 1 });
    inject("k8s_control_plane_down", "main-cp1");
    physics.run(MINUTE);
    expect(world.stateAs("k8s-main", "k8s_cluster").apiUp).toBe(false);
    expect(status()).toBe("healthy");
    expect(raw("kubectl_get", { kind: "pods" }).error).toMatch(/refused/);
    expect(raw("kubectl_scale", { workload: "web", replicas: 2 }).error).toMatch(/refused/);
    inject("k8s_node_notready", "main-w1");
    physics.run(8 * MINUTE);
    expect(status()).toBe("degraded");
    expect(pods().some((p) => p.node === "main-w1")).toBe(true);
    expect(fromCluster()).toHaveLength(0);
  });

  test("three control-plane nodes: one lost is nothing, two lost is no quorum", () => {
    const { world, physics, inject, status } = lab({ controlPlane: 3 });
    inject("k8s_control_plane_down", "main-cp1");
    physics.run(MINUTE);
    const cluster = () => world.stateAs("k8s-main", "k8s_cluster");
    expect(cluster()).toMatchObject({ apiUp: true, cpUp: 2, quorum: true });
    inject("k8s_control_plane_down", "main-cp2");
    physics.run(MINUTE);
    expect(cluster()).toMatchObject({ apiUp: false, cpUp: 1, quorum: false });
    expect(status()).toBe("healthy");
  });

  test("etcd loses its quorum: the API is gone, a dead node's pods stay where they are; fixing the kubelet still helps", () => {
    const { world, physics, inject, status, sh } = lab();
    inject("k8s_etcd_quorum_lost", "k8s-main", { down: 2 });
    inject("k8s_node_notready", "main-w1");
    physics.run(7 * MINUTE);
    expect(world.stateAs("k8s-main", "k8s_cluster")).toMatchObject({ apiUp: false, etcdUp: 1 });
    expect(world.alarms().some((a) => a.code === "k8s_api_down")).toBe(true);
    expect(status()).toBe("degraded");
    sh("vm-main-w1", "systemctl restart kubelet");
    physics.run(MINUTE);
    expect(status()).toBe("healthy");
  });
});

describe("a pod crashes again and again [REQ-096]", () => {
  test("it backs off 10 s, 20 s, 40 s … and the service stops", () => {
    const { world, physics, inject, status, pods, call } = lab();
    inject("k8s_pod_crashloop", "web");
    physics.run(2 * MINUTE);
    expect(pods().every((p) => p.phase === "CrashLoopBackOff")).toBe(true);
    expect(status()).toBe("down");
    expect(world.alarms().some((a) => a.code === "k8s_crashloop")).toBe(true);
    const before = pods()[0]?.restarts ?? 0;
    physics.run(10 * MINUTE);
    const after = pods()[0]?.restarts ?? 0;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(before + 8);
    const name = pods()[0]?.name as string;
    expect(call("kubectl_logs", { pod: name }).output).toMatch(/invalid configuration/);
    expect(call("kubectl_describe", { kind: "pod", name }).output).toMatch(/CrashLoopBackOff/);
  });

  test("deleting a pod does not help, a rollout restart does, one pod at a time", () => {
    const { world, physics, inject, status, pods, call } = lab();
    inject("k8s_pod_crashloop", "web");
    physics.run(2 * MINUTE);
    call("kubectl_delete_pod", { pod: pods()[0]?.name });
    physics.run(MINUTE);
    expect(pods().every((p) => p.phase === "CrashLoopBackOff")).toBe(true);
    call("kubectl_rollout_restart", { workload: "web" });
    physics.run(10);
    expect(world.faultsOn("web")).toHaveLength(0);
    expect(pods().length).toBeGreaterThan(4); // the new pod stands beside the old one
    physics.run(3 * MINUTE);
    expect(pods()).toHaveLength(4);
    expect(pods().every((p) => p.phase === "Running" && p.restarts === 0)).toBe(true);
    expect(status()).toBe("healthy");
  });
});

describe("images cannot be pulled [REQ-096]", () => {
  test("running pods are fine, a new pod waits in ImagePullBackOff, a rollout does not take the old ones away", () => {
    const { physics, inject, status, pods, call } = lab();
    inject("k8s_image_pull_failure", "k8s-main");
    physics.run(MINUTE);
    expect(status()).toBe("healthy");
    call("kubectl_rollout_restart", { workload: "web" });
    physics.run(3 * MINUTE);
    expect(pods().some((p) => p.phase === "ImagePullBackOff")).toBe(true);
    expect(pods().filter((p) => p.phase === "Running")).toHaveLength(4);
    expect(status()).toBe("healthy");
  });
});

describe("a node runs short of disk [REQ-096]", () => {
  test("its pods are evicted and made again elsewhere; cleaning the disk ends the pressure; uncordon lets it take pods", () => {
    const { world, physics, inject, status, pods, sh, call, fromCluster } = lab();
    inject("k8s_disk_pressure", "main-w1");
    physics.run(MINUTE);
    const node = () => world.stateAs("main-w1", "k8s_node");
    expect(node()).toMatchObject({ diskPressure: true, unschedulable: true });
    expect(pods().filter((p) => p.phase === "Evicted").length).toBeGreaterThan(0);
    expect(pods().filter((p) => p.phase === "Running")).toHaveLength(4);
    expect(pods().some((p) => p.phase !== "Evicted" && p.node === "main-w1")).toBe(false);
    expect(status()).toBe("healthy");
    expect(fromCluster().length).toBeGreaterThan(0);
    expect(sh("vm-main-w1", "df -h").output).toMatch(/9\d%/);
    sh("vm-main-w1", "rm /var/log/messages-old");
    physics.run(MINUTE);
    expect(node().diskPressure).toBe(false);
    expect(node().unschedulable).toBe(true);
    expect(world.faultsOn("main-w1")).toHaveLength(0);
    call("kubectl_uncordon", { node: "main-w1" });
    expect(node().unschedulable).toBe(false);
  });
});

describe("the network plugin of a node dies [REQ-096]", () => {
  test("the node says Ready and its pods say Running, yet the service slows; restarting containerd fixes it", () => {
    const { world, physics, inject, status, call, sh } = lab();
    inject("k8s_cni_failure", "main-w1");
    physics.run(MINUTE);
    expect(world.stateAs("main-w1", "k8s_node").status).toBe("Ready");
    expect(call("kubectl_get", { kind: "pods" }).clusters[0].output).not.toMatch(/0\/1/);
    expect(status()).toBe("degraded");
    sh("vm-main-w1", "systemctl restart containerd");
    physics.run(10);
    expect(status()).toBe("healthy");
  });

  test("draining the node moves its pods and the service is whole again", () => {
    const { physics, inject, status, call, pods } = lab();
    inject("k8s_cni_failure", "main-w1");
    physics.run(MINUTE);
    call("kubectl_drain", { node: "main-w1" });
    physics.run(MINUTE);
    expect(pods().every((p) => p.node !== "main-w1")).toBe(true);
    expect(status()).toBe("healthy");
  });
});

describe("the cluster is out of room [REQ-096]", () => {
  test("pods of a lost node wait as Pending with a reason; making room lets them in", () => {
    const { physics, inject, status, pods, call } = lab({ webReplicas: 6, webMilli: 1200 });
    inject("k8s_resource_exhausted", "k8s-main", { lostPct: 50 });
    inject("k8s_node_notready", "main-w1");
    physics.run(8 * MINUTE);
    const waiting = pods().filter((p) => p.phase === "Pending");
    expect(waiting.length).toBeGreaterThan(0);
    expect(status()).toBe("degraded");
    const why = call("kubectl_describe", { kind: "pod", name: waiting[0]?.name }).output as string;
    expect(why).toMatch(/FailedScheduling/);
    call("kubectl_scale", { workload: "report", replicas: 0 });
    physics.run(MINUTE);
    expect(pods().every((p) => p.phase === "Running")).toBe(true);
    expect(status()).toBe("healthy");
  });
});

describe("two clusters back each other up [REQ-096]", () => {
  test("a whole cluster down only slows the service, and the cluster says it sent the traffic over", () => {
    const { world, physics, inject, status, fromCluster } = lab({ second: true });
    expect(status()).toBe("healthy");
    inject("k8s_pod_crashloop", "web");
    physics.run(2 * MINUTE);
    expect(world.stateAs("web", "k8s_workload").pods.every((p) => p.phase !== "Running")).toBe(
      true,
    );
    expect(status()).toBe("degraded");
    expect(world.stateAs("k8s-main", "k8s_cluster").shifted).toBe(true);
    expect(fromCluster().some((e) => e.type === "note")).toBe(true);
  });
});

describe("a cluster of hosts balances itself (DRS) [REQ-096]", () => {
  test("a hot host with an idle neighbour has a VM moved off it by the cluster", () => {
    const bp = sampleBlueprint();
    const world = World.fromBlueprint(
      {
        ...bp,
        entities: bp.entities.map((e) =>
          e.id === "cl1" ? { ...e, props: { ...e.props, drs: true } } : e,
        ),
      },
      new Catalog(),
    );
    const physics = new Physics(world);
    physics.settle();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "hot", type: "cpu_runaway", target: "srv-a1", params: { util: 0.95 } },
      },
      "scenario",
    );
    world.apply({ type: "load.set", target: "vm-web", value: 0.6 }, "scenario");
    physics.run(2 * MINUTE);
    const moves = world.events().filter((e) => e.type === "vm.migrate" && e.cause === "cluster");
    expect(moves.length).toBeGreaterThan(0);
    expect(world.stateAs("vm-web", "vm").hostId).not.toBe("srv-a1");
  });
});
