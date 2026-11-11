/**
 * What `kubectl` and `crictl` print on a node of the cluster (REQ-096, REQ-100): the tables are made from the state of
 * the nodes and the pods, the words change with the faults, and the commands the fake does not do say so.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { k8sLab } from "../../packages/core/src/world/test-support/k8s-lab";

function lab() {
  const world = World.fromBlueprint(k8sLab({}), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const box = new Toolbox(TOOL_NAMES);
  const sh = (host: string, cmd: string) => {
    const r = box.call("run_command", { host, cmd }, { world, facades: {} as Facades });
    return r.data as { output: string; exitCode: number };
  };
  const inject = (type: FaultType, target: string) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params: {} } },
      "scenario",
    );
  return { world, physics, sh, inject };
}

const W1 = "vm-main-w1";

describe("kubectl get prints the tables of the API for a cluster in good order [REQ-096]", () => {
  test("nodes list every node with its role and a Ready status", () => {
    const { sh } = lab();
    const r = sh(W1, "kubectl get nodes");
    expect(r.exitCode).toBe(0);
    const rows = r.output.split("\n");
    expect(rows[0]).toMatch(/^NAME\s+STATUS\s+ROLES\s+AGE\s+VERSION$/);
    expect(rows).toHaveLength(7);
    expect(rows.filter((l) => /\bReady\s+control-plane\b/.test(l))).toHaveLength(3);
    expect(rows.filter((l) => /\bReady\s+worker\b/.test(l))).toHaveLength(3);
    expect(sh(W1, "kubectl get node").output).toBe(r.output);
  });

  test("pods and deployments show READY counts, and -n narrows the pods to a namespace", () => {
    const { sh } = lab();
    const pods = sh(W1, "kubectl get pods").output.split("\n");
    expect(pods[0]).toMatch(/^NAMESPACE\s+NAME\s+READY\s+STATUS\s+RESTARTS\s+AGE\s+NODE$/);
    expect(pods.filter((l) => /\b1\/1\s+Running\b/.test(l))).toHaveLength(6);
    expect(sh(W1, "kubectl get pods -n default").output).toBe(pods.join("\n"));
    expect(sh(W1, "kubectl get pods -n prod").output).toBe("No resources found.");
    const deploy = sh(W1, "kubectl get deploy").output;
    expect(deploy).toMatch(/default\s+web\s+4\/4\s+4\s+4/);
    expect(deploy).toMatch(/default\s+report\s+2\/2\s+2\s+2/);
    expect(sh(W1, "kubectl get deployments").output).toBe(deploy);
  });

  test("a worker that is not ready shows NotReady and its pods stop being ready", () => {
    const { sh, inject, physics } = lab();
    inject("k8s_node_notready", "main-w3");
    physics.run(300);
    expect(sh(W1, "kubectl get nodes").output).toMatch(/main-w3\s+NotReady\s+worker/);
    expect(sh(W1, "kubectl get pods").output).toMatch(/0\/1\s+(Running|Pending|ContainerCreating)/);
  });

  test("a crashing deployment shows its restarts and a status other than Running", () => {
    const { sh, inject, physics } = lab();
    inject("k8s_pod_crashloop", "web");
    physics.run(300);
    expect(sh(W1, "kubectl get pods").output).toMatch(/CrashLoopBackOff/);
  });
});

describe("kubectl describe node and the things the fake does not do [REQ-096] [REQ-100]", () => {
  test("a node is described by name with its conditions, and a name that is not there is NotFound", () => {
    const { sh } = lab();
    const r = sh(W1, "kubectl describe node main-w1");
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("main-w1");
    expect(r.output).toContain("DiskPressure");
    expect(r.output).toContain("KubeletHasNoDiskPressure");
    expect(sh(W1, "kubectl describe node zz")).toMatchObject({
      output: 'Error from server (NotFound): nodes "zz" not found',
      exitCode: 1,
    });
  });

  test("disk pressure shows in the condition and the node is cordoned", () => {
    const { sh, inject, physics } = lab();
    inject("k8s_disk_pressure", "main-w1");
    physics.run(120);
    expect(sh(W1, "kubectl describe node main-w1").output).toContain("KubeletHasDiskPressure");
    expect(sh(W1, "kubectl get nodes").output).toMatch(/main-w1\s+Ready,SchedulingDisabled/);
  });

  test("a verb the fake does not have prints what it can do and exits 1", () => {
    const { sh } = lab();
    for (const cmd of ["kubectl", "kubectl logs x", "kubectl get svc", "kubectl describe"]) {
      const r = sh(W1, cmd);
      expect(r.exitCode, cmd).toBe(1);
      expect(r.output, cmd).toContain("이 kubectl 명령은 아직 못 해요");
    }
  });

  test("the API being down is the refusal the real client prints", () => {
    const { sh, inject, physics } = lab();
    inject("k8s_control_plane_down", "main-cp1");
    inject("k8s_control_plane_down", "main-cp2");
    inject("k8s_control_plane_down", "main-cp3");
    physics.run(120);
    const r = sh(W1, "kubectl get nodes");
    expect(r.exitCode).not.toBe(0);
    expect(r.output).toContain("refused");
  });

  test("on a machine that is not a node there is no kubectl and no crictl", () => {
    const { sh } = lab();
    for (const cmd of ["kubectl get nodes", "crictl ps"]) {
      const r = sh("srv-a1", cmd);
      expect(r.exitCode).toBe(127);
      expect(r.output).toContain("command not found");
    }
  });
});

describe("crictl ps lists the containers on a node, API or not [REQ-096]", () => {
  test("a worker lists the pods that stand on it and a control-plane node lists none", () => {
    const { sh } = lab();
    const w1 = sh(W1, "crictl ps");
    expect(w1.output.split("\n")[0]).toMatch(/^CONTAINER\s+IMAGE\s+CREATED\s+STATE\s+NAME\s+POD$/);
    expect(w1.output).toMatch(/registry\.local\/report:1\.4\.2\s+\S+ ago\s+Running\s+report/);
    expect(sh("vm-main-cp1", "crictl ps").output.split("\n")).toHaveLength(1);
  });

  test("a verb other than ps is refused with what it can do", () => {
    const { sh } = lab();
    expect(sh(W1, "crictl images")).toMatchObject({
      output: "이 crictl 명령은 아직 못 해요. 되는 것: crictl ps",
      exitCode: 1,
    });
  });

  test("a crashing pod is Exited on its node while the API says CrashLoopBackOff", () => {
    const { sh, inject, physics } = lab();
    inject("k8s_pod_crashloop", "web");
    physics.run(300);
    expect(sh("vm-main-w3", "crictl ps").output).toMatch(/Exited\s+web/);
  });
});
