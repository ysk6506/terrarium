/** The sample hall with a small switched network: two racks of servers, two spines sharing a gateway, one core. */
import type { Blueprint, Entity } from "../blueprint";
import { sampleBlueprint, withChanges } from "./sample";

const sw = (id: string, rack: string, u: number, modelId: string): Entity => ({
  id,
  kind: "switch",
  name: id,
  parentId: rack,
  placement: { type: "unit", u },
  modelId,
  props: {},
});

let seq = 0;
const net = (from: string, to: string) => ({
  id: `n-${from}-${to}-${seq++}`,
  kind: "network" as const,
  from,
  to,
  props: {},
});

/**
 * tor-a (srv-a1, srv-a2) and tor-b (srv-b1, stor-b) both uplink to sp1 and sp2; sp1 and sp2 uplink to core1.
 * Expected design: domain 0, tor-a VLAN 100 10.0.0.0/24, tor-b VLAN 101 10.0.1.0/24, gateway 10.0.x.1 shared by sp1, sp2.
 */
export function networkLab(): Blueprint {
  seq = 0;
  const base = sampleBlueprint();
  const bp = withChanges(base, {
    entities: [
      sw("tor-b", "rack-b", 40, "sw-tor-48x25g"),
      sw("sp1", "rack-b", 30, "sw-spine-32x100g"),
      sw("sp2", "rack-b", 32, "sw-spine-32x100g"),
      sw("core1", "rack-b", 34, "sw-spine-32x100g"),
    ],
  });
  const links = bp.links.filter(
    (l) => !(l.kind === "network" && (l.from === "srv-b1" || l.from === "stor-b")),
  );
  return {
    ...bp,
    links: [
      ...links,
      net("srv-b1", "tor-b"),
      net("stor-b", "tor-b"),
      net("tor-a", "sp1"),
      net("tor-a", "sp2"),
      net("tor-b", "sp1"),
      net("tor-b", "sp2"),
      net("sp1", "core1"),
      net("sp2", "core1"),
    ],
  };
}
