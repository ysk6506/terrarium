/**
 * What `istioctl proxy-status` prints for the service mesh (REQ-100): one row for each sidecar, with the state of its
 * configuration against the control plane, and the errors the real tool prints when the control plane is down or absent.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type Blueprint, type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { appLab } from "../../packages/core/src/world/test-support/app-lab";

function boot(bp: Blueprint) {
  const world = World.fromBlueprint(bp, new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const box = new Toolbox(TOOL_NAMES);
  const sh = (cmd: string) => {
    const r = box.call("run_command", { host: "srv-a1", cmd }, { world, facades: {} as Facades });
    return r.data as { output: string; exitCode: number };
  };
  const inject = (type: FaultType, target: string) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}`, type, target, params: {} } },
      "scenario",
    );
  return { world, physics, sh, inject };
}

const rows = (output: string) =>
  output
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s{2,}/));

describe("istioctl proxy-status shows each sidecar against the control plane [REQ-100]", () => {
  test("a healthy mesh lists every sidecar as SYNCED on all four configs, and ps is the same command", () => {
    const { sh } = boot(appLab({ level: "mesh" }));
    const r = sh("istioctl proxy-status");
    expect(r.exitCode).toBe(0);
    expect(r.output.split("\n")[0]).toMatch(
      /^NAME\s+CLUSTER\s+CDS\s+LDS\s+EDS\s+RDS\s+ISTIOD\s+VERSION$/,
    );
    const body = rows(r.output);
    expect(body).toHaveLength(4);
    for (const row of body) {
      expect(row[1]).toBe("Kubernetes");
      expect(row.slice(2, 6)).toEqual(["SYNCED", "SYNCED", "SYNCED", "SYNCED"]);
      expect(row[7]).toBe("1.20.3");
    }
    expect(body.map((row) => row[0])).toEqual([
      "app-portal-1.default",
      "app-portal-2.default",
      "app-portal-3.default",
      "app-portal-4.default",
    ]);
    expect(sh("istioctl ps").output).toBe(r.output);
  });

  test("a sidecar that died shows NOT SENT while the others stay SYNCED", () => {
    const { world, sh, inject, physics } = boot(appLab({ level: "mesh" }));
    inject("sidecar_crash", [...world.index.ofKind("mesh_sidecar")][0]?.id as string);
    physics.run(60);
    const body = rows(sh("istioctl ps").output);
    expect(body[0]?.slice(2, 6)).toEqual(["NOT SENT", "NOT SENT", "NOT SENT", "NOT SENT"]);
    expect(body.slice(1).every((row) => row[2] === "SYNCED")).toBe(true);
  });

  test("a control plane that is down is the connection error of the real tool", () => {
    const { world, sh, inject, physics } = boot(appLab({ level: "mesh" }));
    inject("mesh_control_down", [...world.index.ofKind("mesh_control")][0]?.id as string);
    physics.run(60);
    expect(sh("istioctl proxy-status")).toMatchObject({
      output:
        "Error: unable to retrieve Istiod debug information: connection refused (istiod is not running)",
      exitCode: 1,
    });
  });

  test("a world with no mesh says there is no Istio, and a command the fake does not do says which", () => {
    expect(boot(appLab({ level: "lb" })).sh("istioctl proxy-status")).toMatchObject({
      output: "Error: could not find any Istio installation in this cluster",
      exitCode: 1,
    });
    // ADR-0184: analyze is a real istioctl command the fake lacks; a made-up one is istioctl's own error
    expect(boot(appLab({ level: "mesh" })).sh("istioctl analyze")).toMatchObject({
      output:
        "istioctl analyze: 이 흉내에서는 안 돼요\nterrarium: 이 실험장은 istioctl의 analyze 기능을 지원하지 않아요. 실제 istioctl에는 있어요.\nterrarium: istioctl에서 되는 것: proxy-status (ps)\nterrarium: 대신 이 명령은 돼요: istioctl proxy-status",
      exitCode: 1,
    });
    expect(boot(appLab({ level: "mesh" })).sh("istioctl foo")).toMatchObject({
      output: 'Error: unknown command "foo" for "istioctl"',
      exitCode: 1,
    });
  });
});
