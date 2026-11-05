/**
 * The sample hall with the back-end network of a small GPU cluster: three servers with one NIC per rail,
 * eight rail leaves (one per NIC number) and two spines above them, all built as a GPU fabric and running EOS. A storage
 * array on a single cable to one rail shows a host that is not a rail server.
 */
import type { Blueprint, Entity } from "../blueprint";
import { sampleBlueprint, withChanges } from "./sample";

export const RAILS = 8;
export const GPU_SERVERS = ["srv-a1", "srv-a2", "srv-b1"] as const;
export const railLeaf = (rail: number): string => `rail${rail}`;

const sw = (id: string, u: number, modelId: string, tagged: boolean): Entity => ({
  id,
  kind: "switch",
  name: id,
  parentId: "rack-b",
  placement: { type: "unit", u },
  modelId,
  props: { ...(tagged ? { fabric: "gpu" } : {}), nosProfile: "eos/4.32" },
});

/**
 * Eight rail leaves rail1..rail8 and spines gsp1, gsp2; every GPU server cabled to every rail leaf in order.
 * `tagged: false` leaves out the `fabric` property, so the fabric has to be told from the cabling alone.
 */
export function gpuLab(tagged = true): Blueprint {
  const base = sampleBlueprint();
  const leaves = Array.from({ length: RAILS }, (_, i) =>
    sw(railLeaf(i + 1), 22 + i, "sw-tor-48x25g", tagged),
  );
  const spines = [
    sw("gsp1", 31, "sw-spine-32x100g", tagged),
    sw("gsp2", 32, "sw-spine-32x100g", tagged),
  ];
  const bp = withChanges(base, { entities: [...leaves, ...spines] });
  let seq = 0;
  const net = (from: string, to: string) => ({
    id: `g-${from}-${to}-${seq++}`,
    kind: "network" as const,
    from,
    to,
    props: {},
  });
  const cables = [
    ...GPU_SERVERS.flatMap((s) => leaves.map((l) => net(s, l.id))),
    net("stor-b", railLeaf(1)),
    ...leaves.flatMap((l) => spines.map((s) => net(l.id, s.id))),
  ];
  return { ...bp, links: [...bp.links.filter((l) => l.kind !== "network"), ...cables] };
}
