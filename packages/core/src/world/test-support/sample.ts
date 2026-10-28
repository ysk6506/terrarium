/** A small but complete data hall used by tests across units. */
import type { Blueprint, Entity, Link, LinkKind, PropValue } from "../blueprint";

const e = (
  id: string,
  kind: Entity["kind"],
  parentId: string | undefined,
  placement: Entity["placement"],
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  kind,
  name: extra.name ?? id,
  ...(parentId ? { parentId } : {}),
  ...(placement ? { placement } : {}),
  props: {},
  ...extra,
});

let linkSeq = 0;
const l = (
  kind: LinkKind,
  from: string,
  to: string,
  props: Record<string, PropValue> = {},
): Link => ({ id: `l-${kind}-${from}-${to}-${linkSeq++}`, kind, from, to, props });

/** site > bldg > fl1 > hall (12x10) with a cold-aisle containment, two racks, cooling, power and VMs. */
export function sampleBlueprint(): Blueprint {
  linkSeq = 0;
  const entities: Entity[] = [
    e(
      "site",
      "site",
      undefined,
      { type: "land", w: 200, d: 150 },
      { props: { preset: "giheung" } },
    ),
    e("bldg", "building", "site", { type: "area", x: 10, y: 10, w: 60, d: 40 }),
    e("fl1", "floor", "bldg", { type: "level", level: 1, height: 4.5 }),
    e("hall", "room", "fl1", { type: "area", x: 5, y: 5, w: 12, d: 10 }),
    e(
      "ca1",
      "containment",
      "hall",
      { type: "area", x: 1.5, y: 3.0, w: 6, d: 4.2 },
      { props: { aisle: "cold" } },
    ),
    e("rack-a", "rack", "ca1", { type: "spot", x: 1.5, y: 3.0, rotation: 0 }),
    e("rack-b", "rack", "ca1", { type: "spot", x: 2.1, y: 3.0, rotation: 0 }),
    e("srv-a1", "server", "rack-a", { type: "unit", u: 10 }, { modelId: "srv-2u-compute" }),
    e("srv-a2", "server", "rack-a", { type: "unit", u: 12 }, { modelId: "srv-2u-compute" }),
    e("srv-b1", "server", "rack-b", { type: "unit", u: 10 }, { modelId: "srv-1u-compute" }),
    e("tor-a", "switch", "rack-a", { type: "unit", u: 40 }, { modelId: "sw-tor-48x25g" }),
    e("stor-b", "storage", "rack-b", { type: "unit", u: 20 }, { modelId: "stor-2u-24bay" }),
    e("pdu-a", "pdu", "rack-a", { type: "unit", u: 1 }, { modelId: "pdu-17kw" }),
    e("pdu-b", "pdu", "rack-b", { type: "unit", u: 1 }, { modelId: "pdu-11kw" }),
    e(
      "crah-1",
      "cooling_unit",
      "hall",
      { type: "spot", x: 1.5, y: 0.5, rotation: 0 },
      { modelId: "crah-100kw" },
    ),
    e(
      "crah-2",
      "cooling_unit",
      "hall",
      { type: "spot", x: 5.0, y: 0.5, rotation: 0 },
      { modelId: "crah-100kw" },
    ),
    e(
      "panel-1",
      "power_panel",
      "hall",
      { type: "spot", x: 10.5, y: 0.5, rotation: 0 },
      { modelId: "panel-400a" },
    ),
    e("ups-1", "ups", "fl1", { type: "spot", x: 30, y: 5, rotation: 0 }, { modelId: "ups-500kva" }),
    e("vc", "vcenter", undefined, undefined, { name: "vcsa-01" }),
    e("cl1", "cluster", undefined, undefined, { name: "Cluster-A" }),
    e("vm-web", "vm", undefined, undefined, {
      props: { cpuCount: 8, memoryGiB: 32, cpuDemand: 0.4 },
    }),
    e("vm-db", "vm", undefined, undefined, { props: { cpuCount: 16, memoryGiB: 128 } }),
    e("ds1", "datastore", undefined, undefined, { name: "vsan-ds" }),
  ];
  const links: Link[] = [
    ...["srv-a1", "srv-a2", "tor-a"].map((id) => l("power", id, "pdu-a")),
    ...["srv-b1", "stor-b"].map((id) => l("power", id, "pdu-b")),
    l("power", "pdu-a", "panel-1"),
    l("power", "pdu-b", "panel-1"),
    l("power", "crah-1", "panel-1"),
    l("power", "crah-2", "panel-1"),
    l("power", "panel-1", "ups-1"),
    ...["srv-a1", "srv-a2", "srv-b1", "stor-b"].map((id, i) =>
      l("network", id, "tor-a", { fromPort: "eth0", toPort: `Ethernet${i + 1}/1` }),
    ),
    l("cooling", "rack-a", "crah-1"),
    l("cooling", "rack-b", "crah-1"),
    l("cooling", "rack-b", "crah-2"),
    l("runs_on", "vm-web", "srv-a1"),
    l("runs_on", "vm-db", "srv-a2"),
    l("member_of", "srv-a1", "cl1"),
    l("member_of", "srv-a2", "cl1"),
    l("managed_by", "cl1", "vc"),
    l("stored_on", "vm-db", "ds1"),
    l("backed_by", "ds1", "stor-b"),
  ];
  return {
    schemaVersion: 1,
    id: "sample",
    name: "샘플 데이터홀",
    entities,
    links,
    meta: { source: "test" },
  };
}

/** Replace or add entities/links in a blueprint (tests use this to break one rule at a time). */
export function withChanges(
  bp: Blueprint,
  change: { entities?: Entity[]; links?: Link[]; remove?: string[] },
): Blueprint {
  const remove = new Set(change.remove ?? []);
  const replaced = new Map((change.entities ?? []).map((x) => [x.id, x]));
  const entities = bp.entities.filter((x) => !remove.has(x.id)).map((x) => replaced.get(x.id) ?? x);
  for (const added of change.entities ?? [])
    if (!bp.entities.some((x) => x.id === added.id)) entities.push(added);
  const links = [
    ...bp.links.filter((x) => !remove.has(x.id) && !remove.has(x.from) && !remove.has(x.to)),
    ...(change.links ?? []),
  ];
  return { ...bp, entities, links };
}
