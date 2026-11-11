/** What a packet does when its sender has no cable, or when the address it is sent to belongs to nobody [REQ-064]. */
import { describe, expect, test } from "vitest";
import { Catalog } from "../catalog";
import { ipToInt } from "./net-addr";
import { netModelOf } from "./net-model";
import { ping, trace } from "./net-trace";
import { networkLab } from "./test-support/net-lab";
import { World } from "./world";

const catalog = new Catalog();
const lab = () => World.fromBlueprint(networkLab(), catalog);
const up = () => true;

describe("a packet from a server [REQ-064]", () => {
  test("[REQ-064] an address in the server's own subnet that nobody owns is host-unreachable, one that is owned is delivered", () => {
    const model = netModelOf(lab());
    const host = model.plan.hosts.get("srv-a1");
    expect(host).toBeDefined();
    const from = { kind: "host" as const, host: host as NonNullable<typeof host> };
    const nobody = trace(model, from, ipToInt("10.0.0.200") as number, up);
    expect(nobody).toMatchObject({ delivered: false, failure: "host-unreachable" });
    const neighbour = model.plan.hosts.get("srv-a2");
    const owned = trace(model, from, ipToInt(neighbour?.ip ?? "") as number, up);
    expect(owned).toMatchObject({ delivered: true, at: "srv-a2" });
  });

  test("[REQ-064] a server whose cable is cut cannot send at all", () => {
    const world = lab();
    const cable = world.index
      .outgoing("srv-a1", "network")
      .map((l) => l.id)
      .at(0) as string;
    world.apply(
      { type: "fault.add", fault: { id: "f1", type: "link_down", target: cable, params: {} } },
      "scenario",
    );
    const model = netModelOf(world);
    const host = model.plan.hosts.get("srv-a1");
    expect(host).toBeDefined();
    const from = { kind: "host" as const, host: host as NonNullable<typeof host> };
    expect(trace(model, from, ipToInt("10.0.0.11") as number, up)).toMatchObject({
      delivered: false,
      failure: "no-link",
    });
  });

  test("[REQ-064] a ping to the address of a switch is answered by the switch, and the answer finds its way back", () => {
    const model = netModelOf(lab());
    const host = model.plan.hosts.get("srv-a1");
    const gateway = ipToInt(host?.gateway ?? "") as number;
    const result = ping(
      model,
      { kind: "host", host: host as NonNullable<typeof host> },
      gateway,
      up,
    );
    expect(result.ok).toBe(true);
    expect(result.forward.delivered).toBe(true);
    expect(result.back?.delivered).toBe(true);
  });
});
