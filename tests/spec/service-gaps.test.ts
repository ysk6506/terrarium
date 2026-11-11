/**
 * How a service is told to be doing from the host under it, and what moving a service does to the hosts (REQ-087,
 * ADR-0091; the operating system under it is REQ-098): a host that is rebooting, throttled or being moved, a path that is
 * half lost, and the process a failover starts on the standby and stops on the old place.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { serviceHealth, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../../packages/core/src/world/test-support/service-lab";
import { lab } from "./test-support/deep-os-lab";

describe("what a service says about the host it runs on [REQ-087]", () => {
  test("[REQ-087] a server that is rebooting takes its service down and says so", () => {
    const { sh, world, physics } = lab();
    sh("reboot");
    physics.run(5);
    const health = serviceHealth(world, "svc-license");
    expect(health.status).toBe("down");
    expect(health.reasons.join(" ")).toMatch(/재부팅 중이에요|운영체제가 내려가 있어요/);
  });

  test("[REQ-087] a server that throttles for heat slows its service, and says it is the heat", () => {
    const { world } = lab();
    world.stateAs("srv-a2", "server").throttled = true;
    const health = serviceHealth(world, "svc-license");
    expect(health.status).toBe("degraded");
    expect(health.reasons.join(" ")).toContain("CPU가 열 때문에 느려졌어요");
  });

  test("[REQ-087] a VM that is being moved to another server is slow for as long as the move takes", () => {
    const { world, physics } = lab();
    // the cluster scheduler (DRS) marks a VM it is moving this way
    world.stateAs("vm-web", "vm").migratingUntil = world.time() + 60;
    const during = serviceHealth(world, "svc-web");
    expect(during.status).toBe("degraded");
    expect(during.reasons.join(" ")).toContain("를 다른 서버로 옮기는 중이에요");
    physics.run(120);
    expect(serviceHealth(world, "svc-web").status).toBe("healthy");
  });

  test("[REQ-087] a VM cannot be moved to a server that is off, or to the one it is on", () => {
    const bp = serviceLab();
    const world = World.fromBlueprint(
      {
        ...bp,
        entities: bp.entities.map((e) =>
          e.id === "srv-b1" ? { ...e, props: { ...e.props, adminOff: true } } : e,
        ),
      },
      new Catalog(),
    );
    new Physics(world).settle();
    expect(() =>
      world.apply({ type: "vm.migrate", target: "vm-web", host: "srv-b1" }, "operator"),
    ).toThrow("'srv-b1' is off, so a VM cannot be moved to it");
    const onto = world.stateAs("vm-web", "vm").hostId ?? "srv-a1";
    expect(() =>
      world.apply({ type: "vm.migrate", target: "vm-web", host: onto }, "operator"),
    ).toThrow(`'vm-web' already runs on '${onto}'`);
  });
});

describe("a failover starts the process on the standby and stops it on the old place [REQ-087]", () => {
  test("[REQ-087] the standby gets a running process of the service with a line in its journal, and the old place a stopped one", () => {
    const { sh, world, physics } = lab();
    // a host that was written to has a state of its own, and the failover edits it
    sh("touch /tmp/q", "srv-b1");
    sh("touch /tmp/q", "vm-web");
    expect(sh("systemctl is-active portal", "srv-b1")).toBe("inactive");
    world.apply({ type: "service.failover", target: "svc-web" }, "operator");
    physics.run(30);
    expect(sh("systemctl is-active portal", "srv-b1")).toBe("active");
    expect(sh("journalctl --no-pager | grep 'Started portal.service.'", "srv-b1")).toContain(
      "systemd[1]: Started portal.service.",
    );
    expect(sh("systemctl is-active portal", "vm-web")).toBe("inactive");
    expect(sh("journalctl --no-pager | grep 'Stopped portal.service.'", "vm-web")).toContain(
      "systemd[1]: Stopped portal.service.",
    );
    expect(world.stateAs("svc-web", "service").runsOn).toEqual(["srv-b1"]);
  });

  test("[REQ-087] a service with nowhere to go cannot be failed over", () => {
    const { world } = lab();
    world.apply({ type: "service.failover", target: "svc-license" }, "operator");
    expect(world.stateAs("svc-license", "service").standby).toEqual(["srv-a2"]);
    const bp = serviceLab();
    const bare = World.fromBlueprint(
      {
        ...bp,
        links: bp.links.filter((l) => !(l.kind === "service_on" && l.props.role === "standby")),
      },
      new Catalog(),
    );
    expect(() =>
      bare.apply({ type: "service.failover", target: "svc-license" }, "operator"),
    ).toThrow("'svc-license' has no standby to move to");
  });
});
