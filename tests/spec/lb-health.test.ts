/**
 * `curl -I /healthz` on a service behind a load balancer (REQ-100): the answer is what the balancer says about the
 * backends, as a health endpoint of a balancer does; a service with no balancer answers as any other web service.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { appLab } from "../../packages/core/src/world/test-support/app-lab";

function lab() {
  const world = World.fromBlueprint(appLab({ level: "lb" }), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const box = new Toolbox(TOOL_NAMES);
  const sh = (cmd: string) => {
    const r = box.call("run_command", { host: "srv-a2", cmd }, { world, facades: {} as Facades });
    return (r.data as { output: string }).output;
  };
  const inject = (type: FaultType, target: string) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params: {} } },
      "scenario",
    );
  return { world, physics, sh, inject };
}

describe("the balancer's health answer counts the backends in rotation [REQ-100]", () => {
  test("a healthy balancer answers 200 with its name and four of four backends, in the headers and in the body", () => {
    const { sh } = lab();
    const head = sh("curl -I http://svc-portal/healthz").split("\n");
    expect(head).toEqual([
      "HTTP/1.1 200 OK",
      "Server: haproxy",
      "Content-Type: application/json",
      "X-LB: lb-portal",
      "X-Backends-Healthy: 4/4",
      "X-Backends-In-Rotation: 4/4",
    ]);
    expect(sh("curl -s http://svc-portal/healthz")).toBe('{"status":"ok"}');
  });

  test("a backend that flaps drops out of the counts at some moment of the next minutes", () => {
    const { sh, inject, physics } = lab();
    inject("lb_backend_flapping", "app-portal-1");
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      physics.run(15);
      const head = sh("curl -I http://svc-portal/healthz");
      seen.add(/X-Backends-Healthy: (\d)\/4/.exec(head)?.[1] ?? "?");
      seen.add(`rot${/X-Backends-In-Rotation: (\d)\/4/.exec(head)?.[1] ?? "?"}`);
    }
    expect([...seen].some((v) => v === "3" || v === "rot3" || v === "2" || v === "rot2")).toBe(
      true,
    );
  });

  test("any other path or a service with no balancer answers as a plain web server", () => {
    const { sh } = lab();
    for (const url of ["http://svc-portal/other", "http://svc-license/healthz"]) {
      const head = sh(`curl -I ${url}`).split("\n");
      expect(head[0], url).toBe("HTTP/1.1 200 OK");
      expect(head[1], url).toBe("Server: nginx");
      expect(
        head.some((l) => l.startsWith("X-LB")),
        url,
      ).toBe(false);
    }
  });
});
