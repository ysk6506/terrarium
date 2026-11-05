/**
 * Building a configuration scenario by hand (REQ-068): the form offers only what the picked switch or PDU really
 * has, picking another switch drops the choice made from the old one's list, and every block reads as a plain
 * sentence on the canvas.
 */
import { emptyScenario, paletteFor } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { networkLab } from "../../../../packages/core/src/world/test-support/net-lab";
import { scenario as sc } from ".";

const index = new BlueprintIndex(networkLab());
const palette = paletteFor(index);
const item = (key: string) => palette.find((p) => p.key === key) as (typeof palette)[number];

/** A canvas with one block of a type, its switch (or PDU) already picked. */
function withBlock(type: string, target?: string) {
  const empty = emptyScenario("s", "lab");
  const { doc, nodeId } = sc.addBlock(empty, item(type), { x: 0, y: 0 });
  return { doc: target ? sc.setParam(doc, nodeId, "target", target) : doc, nodeId };
}

const choice = (fields: sc.Field[], name: string) =>
  fields.find((f) => f.name === name) as Extract<sc.Field, { control: "choice" }>;

describe("picking what a configuration block acts on [REQ-068] [REQ-034]", () => {
  test("every configuration block is in the palette and can be dropped on a network world", () => {
    for (const key of [
      "port_admin",
      "port_vlan",
      "svi_admin",
      "bgp_admin",
      "route_del",
      "outlet_set",
    ])
      expect(item(key)).toMatchObject({ category: "operation", available: true });
  });

  test("before a switch is picked the list is empty and says to pick one first", () => {
    const { doc, nodeId } = withBlock("port_admin");
    const peer = choice(sc.fieldsOf(doc, nodeId, index), "peer");
    expect(peer.choices).toEqual([]);
    expect(peer.help).toMatch(/먼저 위에서 장비를 고르세요/);
  });

  test("the list is what that switch really has, in the names people use", () => {
    const port = withBlock("port_admin", "tor-a");
    const peers = choice(sc.fieldsOf(port.doc, port.nodeId, index), "peer").choices;
    expect(peers.map((c) => c.value)).toContain("srv-a1");
    expect(peers.find((c) => c.value === "srv-a1")?.label).toMatch(/srv-a1.*포트 \d+번/);
    expect(peers.map((c) => c.value)).not.toContain("srv-b1");

    const svi = withBlock("svi_admin", "sp1");
    expect(
      choice(sc.fieldsOf(svi.doc, svi.nodeId, index), "vlan").choices.map((c) => c.value),
    ).toEqual(["100", "101"]);

    const route = withBlock("route_del", "core1");
    expect(
      choice(sc.fieldsOf(route.doc, route.nodeId, index), "route").choices.map((c) => c.value),
    ).toEqual(["10.0.0.0/23 via 172.16.0.0", "10.0.0.0/23 via 172.16.0.2"]);

    const outlet = withBlock("outlet_set", "pdu-a");
    expect(choice(sc.fieldsOf(outlet.doc, outlet.nodeId, index), "outlet").choices[0]?.label).toBe(
      "1번 — srv-a1",
    );
  });

  test("a switch with nothing to offer says why instead of showing an empty box", () => {
    const bgp = withBlock("bgp_admin", "tor-a");
    const peer = choice(sc.fieldsOf(bgp.doc, bgp.nodeId, index), "peer");
    expect(peer.choices).toEqual([]);
    expect(peer.help).toMatch(/BGP를 쓰지 않아요/);
  });

  test("choosing another switch drops what was picked from the old one's list", () => {
    let { doc, nodeId } = withBlock("port_admin", "tor-a");
    doc = sc.setParam(doc, nodeId, "peer", "srv-a1");
    expect(doc.nodes.find((n) => n.id === nodeId)?.params.peer).toBe("srv-a1");
    // the same switch again changes nothing
    doc = sc.setParam(doc, nodeId, "target", "tor-a");
    expect(doc.nodes.find((n) => n.id === nodeId)?.params.peer).toBe("srv-a1");
    // another switch clears it, and the choices are the new switch's
    doc = sc.setParam(doc, nodeId, "target", "tor-b");
    expect(doc.nodes.find((n) => n.id === nodeId)?.params).not.toHaveProperty("peer");
    expect(choice(sc.fieldsOf(doc, nodeId, index), "peer").choices.map((c) => c.value)).toContain(
      "srv-b1",
    );
  });

  test("on the canvas each block reads as a sentence with names, not addresses or ids", () => {
    const summary = (type: string, params: Record<string, unknown>) => {
      const { doc, nodeId } = withBlock(type);
      let next = doc;
      for (const [k, v] of Object.entries(params)) next = sc.setParam(next, nodeId, k, v as never);
      const node = next.nodes.find((n) => n.id === nodeId) as (typeof next.nodes)[number];
      return sc.summaryOf(node, index);
    };
    expect(summary("port_admin", { target: "tor-a", peer: "srv-a1", down: true })).toBe(
      "tor-a의 srv-a1 쪽 포트를 꺼요",
    );
    expect(summary("port_vlan", { target: "tor-a", peer: "srv-a1", vlan: 999 })).toBe(
      "tor-a의 srv-a1 쪽 포트를 VLAN 999로",
    );
    expect(summary("svi_admin", { target: "sp1", vlan: "100", down: true })).toBe(
      "sp1의 VLAN 100 인터페이스를 꺼요",
    );
    expect(summary("route_del", { target: "core1", route: "10.0.0.0/23 via 172.16.0.0" })).toBe(
      "core1에서 10.0.0.0/23 → 172.16.0.0 경로를 지워요",
    );
    expect(summary("outlet_set", { target: "pdu-a", outlet: "1", on: false })).toBe(
      "pdu-a 1번 콘센트를 꺼요",
    );
    expect(summary("bgp_admin", { target: "tor-a", peer: "sp1", down: false })).toBe(
      "tor-a의 BGP 이웃 sp1을 켜요",
    );
  });
});
