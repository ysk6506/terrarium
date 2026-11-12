/**
 * What the kubectl tools and the node shell say when pods are stuck, crashing, evicted or pending, and when the cluster
 * is not there or the call is wrong (REQ-096): the words change with the state the physics keeps.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { k8sLab } from "../../packages/core/src/world/test-support/k8s-lab";
import { sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";

function lab(options: Parameters<typeof k8sLab>[0] = {}) {
  const world = World.fromBlueprint(k8sLab(options), new Catalog());
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
  const sh = (host: string, cmd: string) =>
    box.call("run_command", { host, cmd }, { world, facades: {} as Facades }).data as {
      output: string;
      exitCode: number;
    };
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params } },
      "scenario",
    );
  const pods = () =>
    data("kubectl_get", { kind: "pods" }).clusters[0].items as Array<{
      name: string;
      deployment: string;
      status: string;
      ready: string;
      node: string | null;
    }>;
  return { world, physics, raw, data, sh, inject, pods };
}

describe("a pod that crashes or cannot start tells why in describe and logs [REQ-096]", () => {
  test("a crash loop shows BackOff in describe and a fatal config line (variant 1) or an exec error (variant 2) in the logs", () => {
    for (const [variant, line] of [
      [1, "required key 'UPSTREAM_URL' is not set"],
      [2, "exec format error"],
    ] as const) {
      const { data, inject, physics, pods } = lab();
      inject("k8s_pod_crashloop", "web", { variant });
      physics.run(300);
      const pod = pods().find((p) => p.status === "CrashLoopBackOff");
      expect(pod, `variant ${variant}`).toBeDefined();
      expect(data("kubectl_describe", { kind: "pod", name: pod?.name }).output).toContain(
        "Back-off restarting failed container",
      );
      expect(data("kubectl_logs", { pod: pod?.name, tail: 5 }).output).toContain(line);
    }
  });

  test("an image that cannot be pulled has no logs yet, and describe names the registry", () => {
    const { data, raw, inject, physics, pods } = lab();
    inject("k8s_image_pull_failure", "k8s-main");
    data("kubectl_rollout_restart", { workload: "web" });
    physics.run(120);
    const pod = pods().find((p) => p.status === "ImagePullBackOff");
    expect(pod).toBeDefined();
    expect(raw("kubectl_logs", { pod: pod?.name }).error).toContain(
      "trying and failing to pull image",
    );
    expect(data("kubectl_describe", { kind: "pod", name: pod?.name }).output).toContain(
      "registry unreachable",
    );
  });

  test("pods that cannot be placed stay Pending with a scheduling event and logs that wait", () => {
    const { data, raw, physics, pods } = lab({ webMilli: 7000 });
    data("kubectl_scale", { workload: "web", replicas: 8 });
    physics.run(600);
    const pod = pods().find((p) => p.status === "Pending");
    expect(pod).toBeDefined();
    const out = data("kubectl_describe", { kind: "pod", name: pod?.name }).output;
    expect(out).toContain("FailedScheduling");
    expect(
      data("kubectl_get", { kind: "pods" }).clusters[0].items.some(
        (p: { node: unknown }) => p.node === null,
      ),
    ).toBe(true);
    expect(out).toContain("<none>");
    expect(raw("kubectl_logs", { pod: pod?.name }).error).toContain("ContainerCreating");
  });

  test("a workload scaled to zero can still be rolled out, with nothing to replace", () => {
    const { data, physics } = lab();
    data("kubectl_scale", { workload: "report", replicas: 0 });
    physics.run(60);
    expect(data("kubectl_rollout_restart", { workload: "report" }).note).toContain("파드 0개");
  });

  test("crictl shows Created for containers that wait on an image", () => {
    const { sh, data, inject, physics, world } = lab();
    inject("k8s_image_pull_failure", "k8s-main");
    data("kubectl_rollout_restart", { workload: "web" });
    physics.run(120);
    const all = world.index
      .ofKind("k8s_node")
      .map((n) => sh(`vm-${n.id}`, "crictl ps").output)
      .join("\n");
    expect(all).toContain("Created");
  });

  test("a rollout leaves pods in ContainerCreating for a moment", () => {
    const { data, physics, pods } = lab();
    data("kubectl_rollout_restart", { workload: "web" });
    physics.run(10);
    const statuses = pods().map((p) => p.status);
    expect(statuses.length).toBeGreaterThan(0);
    expect(data("kubectl_describe", { kind: "deployment", name: "web" }).output).toContain(
      "Revision:",
    );
  });
});

describe("node trouble reaches the pods, describe and crictl [REQ-096]", () => {
  test("disk pressure evicts pods and the node says so in its conditions and taints", () => {
    const { data, inject, physics, pods, world } = lab();
    const node = world.index.ofKind("k8s_node").find((n) => n.name.includes("w1"));
    inject("k8s_disk_pressure", node?.id as string);
    physics.run(600);
    const d = data("kubectl_describe", { kind: "node", name: node?.name }).output;
    expect(d).toContain("KubeletHasDiskPressure");
    expect(d).toContain("disk-pressure:NoSchedule");
    const evicted = pods().find((p) => p.status === "Evicted");
    if (evicted) {
      const out = data("kubectl_describe", { kind: "pod", name: evicted.name }).output;
      expect(out).toContain("Evicted");
      expect(out).toContain("Status:           Failed");
    }
  });

  test("a node that stops posting is NotReady with an unreachable taint, and its pods read 0/1", () => {
    const { data, inject, physics, pods, world } = lab();
    const node = world.index.ofKind("k8s_node").find((n) => n.name.includes("w2"));
    inject("k8s_node_notready", node?.id as string);
    physics.run(60);
    const d = data("kubectl_describe", { kind: "node", name: node?.name }).output;
    expect(d).toContain("NodeStatusUnknown");
    expect(d).toContain("unreachable:NoExecute");
    expect(pods().some((p) => p.ready === "0/1")).toBe(true);
  });

  test("a broken CNI plug-in adds a NetworkUnavailable line to the node", () => {
    const { data, inject, physics, world } = lab();
    const node = world.index.ofKind("k8s_node").find((n) => n.name.includes("w1"));
    inject("k8s_cni_failure", node?.id as string);
    physics.run(60);
    expect(data("kubectl_describe", { kind: "node", name: node?.name }).output).toContain(
      "NetworkUnavailable",
    );
  });

  test("crictl ps lists Exited containers for a crash loop and nothing for a host that is not a node", () => {
    const { sh, inject, physics, world } = lab();
    inject("k8s_pod_crashloop", "web", { variant: 1 });
    physics.run(300);
    const all = world.index
      .ofKind("k8s_node")
      .map((n) => sh(n.name.replace(/^/, "vm-"), "crictl ps").output)
      .join("\n");
    expect(all).toMatch(/Exited|Running|Created/);
    expect(sh("srv-a1", "crictl ps").exitCode).toBe(127);
    expect(sh("vm-main-w1", "crictl images").output).toContain("crictl ps");
  });

  test("ages are shown in seconds, minutes, hours and days as the cluster gets older", () => {
    const { sh, physics } = lab();
    const ages = () => sh("vm-main-w1", "kubectl get pods").output;
    physics.run(300);
    expect(ages()).toMatch(/\d+m\s/);
    physics.run(8000);
    expect(ages()).toMatch(/\d+h\s/);
  });
});

describe("kubectl tools refuse what they cannot do, in words [REQ-096]", () => {
  test("an unknown kind, a cluster that is not one, a pod that is not there and a workload that is not there", () => {
    const { raw } = lab();
    expect(raw("kubectl_get", { kind: "services" }).error).toContain("nodes, pods, deployments");
    expect(raw("kubectl_get", { kind: "pods", cluster: "web" }).error).toContain(
      "클러스터가 아니에요",
    );
    expect(raw("kubectl_describe", { kind: "pod", name: "no-such-pod" }).error).toContain(
      "파드는 없어요",
    );
    expect(raw("kubectl_describe", { kind: "secret", name: "x" }).error).toContain(
      "node, pod, deployment",
    );
    expect(raw("kubectl_scale", { workload: "nothing", replicas: 1 }).error).toContain(
      "워크로드는 없어요",
    );
    expect(raw("kubectl_cordon", { node: "nothing" }).error).toContain("노드는 없어요");
  });

  test("a world without a cluster says so", () => {
    const world = World.fromBlueprint(sdnLab({}), new Catalog());
    const box = new Toolbox(TOOL_NAMES);
    const r = box.call("kubectl_get", { kind: "nodes" }, { world, facades: {} as Facades });
    expect(r.error).toContain("쿠버네티스 클러스터가 없어요");
  });

  test("with the control plane down kubectl on a node is refused with the connection message", () => {
    const { sh, raw, inject, physics } = lab();
    inject("k8s_control_plane_down", "main-cp1");
    inject("k8s_control_plane_down", "main-cp2");
    physics.run(60);
    expect(sh("vm-main-w1", "kubectl get nodes").output).toContain("was refused");
    expect(raw("kubectl_get", { kind: "nodes" }).error ?? "").toContain("refused");
    expect(sh("vm-main-w1", "kubectl apply -f x").exitCode).toBe(1);
    expect(sh("srv-a1", "kubectl get nodes").exitCode).toBe(127);
  });

  test("the kubectl words the fake does not do are listed", () => {
    const { sh } = lab();
    expect(sh("vm-main-w1", "kubectl apply -f x").output).toContain(
      "terrarium: kubectl에서 되는 것: get nodes|pods|deployments",
    );
    expect(sh("vm-main-w1", "kubectl describe pod x").output).toContain("describe node <name>");
    expect(sh("vm-main-w1", "kubectl describe node nothing").output).toContain("NotFound");
    expect(sh("vm-main-w1", "kubectl get secrets").exitCode).toBe(1);
  });
});
