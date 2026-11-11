/**
 * How the fake network turns a typed name into a thing, and whether that thing answers (REQ-098, ADR-0117): any case,
 * with or without a domain, by id, by name or by the service's process; a switch, a host and a place answer a ping
 * differently, and a host that is down does not answer.
 */
import { describe, expect, test } from "vitest";
import { Catalog } from "../../catalog";
import { serviceLab } from "../test-support/service-lab";
import { World } from "../world";
import { pingable, resolveName, resolverAnswers, resolverOf } from "./net-names";

const lab = () => ({ world: World.fromBlueprint(serviceLab(), new Catalog()) });

describe("a typed name is resolved to a thing [REQ-098]", () => {
  test("[REQ-098] an id or a name resolves in any case and with any domain behind it", () => {
    const { world } = lab();
    expect(resolveName(world, "SRV-A2")).toEqual({ id: "srv-a2" });
    expect(resolveName(world, "srv-a2.corp.example.com")).toEqual({ id: "srv-a2" });
    expect(resolveName(world, "Cluster-A")).toEqual({ id: "cl1" });
    expect(resolveName(world, "no-such-host")).toBeUndefined();
    expect(resolveName(world, "")).toBeUndefined();
  });

  test("[REQ-098] a service resolves to the host it runs on, by id, by short id, or by the name it is shown under", () => {
    const { world } = lab();
    expect(resolveName(world, "svc-license")).toEqual({ id: "srv-a2", service: "svc-license" });
    expect(resolveName(world, "license")).toEqual({ id: "srv-a2", service: "svc-license" });
    expect(resolveName(world, "svc-web.corp")).toEqual({ id: "vm-web", service: "svc-web" });
    expect(resolveName(world, "사내 포털")).toEqual({ id: "svc-web", service: "svc-web" });
  });
});

describe("what answers a ping [REQ-098]", () => {
  test("[REQ-098] a switch, a host and a place that is not a host all answer while they are up", () => {
    const { world } = lab();
    for (const id of ["tor-a", "srv-a2", "vm-web", "stor-b", "rack-a", "ds1"])
      expect(pingable(world, id)).toBe(true);
  });

  test("[REQ-098] a switch that has failed does not answer, and neither does a host that was turned off", () => {
    const { world } = lab();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "f1", type: "switch_failure", target: "tor-a", params: {} },
      },
      "scenario",
    );
    world.stateAs("srv-a2", "server").adminOn = false;
    expect(pingable(world, "tor-a")).toBe(false);
    expect(pingable(world, "srv-a2")).toBe(false);
    expect(pingable(world, "rack-a")).toBe(true);
  });
});

describe("which resolver a host asks [REQ-098]", () => {
  test("[REQ-098] the first nameserver named is the one asked, and a host with no file asks the data centre's", () => {
    expect(resolverOf("search corp\nnameserver 192.0.2.53\nnameserver 10.0.0.2\n")).toBe(
      "192.0.2.53",
    );
    const fallback = resolverOf(undefined);
    expect(resolverOf("")).toBe(fallback);
    expect(resolverOf("# nothing here")).toBe(fallback);
    expect(resolverAnswers(fallback)).toBe(true);
    expect(resolverAnswers("192.0.2.53")).toBe(false);
  });
});
