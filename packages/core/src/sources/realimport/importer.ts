/**
 * realimport (REQ-010, REQ-011): read a graph of reality through a read-only source, map it with a
 * KgMapping, place it, fill in what a simulation needs, and assemble a world. The report says what
 * was read, what was left out and why, and every assumption made, so people can trust the result
 * or fix the mapping.
 */
import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import { BlueprintAssembler } from "@terrarium/core/sources";
import type { Blueprint, EntityKind, Issue, LinkKind } from "@terrarium/core/world";
import { classify } from "./classify";
import { CLOUD_TOPOLOGY_MAPPING, type KgMapping, mappedLabels, mappedRelations } from "./mapping";
import { type RealitySource, readAll } from "./port";
import { type Plan, resolve } from "./resolve";
import { synthesize } from "./synthesize";

export interface ImportOptions {
  readonly mapping?: KgMapping;
  readonly catalog?: Catalog;
  readonly id?: string;
  readonly name?: string;
  /** The site everything is placed on (graphs rarely have one node per campus). */
  readonly siteName?: string;
  /** Only rooms whose name or id contains one of these (case-insensitive); all rooms when empty. */
  readonly rooms?: readonly string[];
  readonly maxEntities?: number;
  readonly pageSize?: number;
  /** Fill in power and cooling the graph does not hold (default: both). */
  readonly assume?: { readonly power?: boolean; readonly cooling?: boolean };
}

export interface ImportReport {
  readonly source: string;
  readonly mapping: string;
  /** What the source holds, by label and relationship type. */
  readonly available: {
    readonly labels: Record<string, number>;
    readonly relationships: Record<string, number>;
  };
  readonly entities: Partial<Record<EntityKind, number>>;
  readonly links: Partial<Record<LinkKind, number>>;
  /** In the source but not in the mapping at all: candidates for a mapping update. */
  readonly unknown: {
    readonly labels: Record<string, number>;
    readonly relationships: Record<string, number>;
  };
  /** Known but deliberately not modelled (virtual switching, peering). */
  readonly ignored: {
    readonly labels: Record<string, number>;
    readonly relationships: Record<string, number>;
  };
  /** Read but not taken: nodes outside the mapping's filters, relationships with no rule or an end left out. */
  readonly filteredOut: Record<string, number>;
  readonly unmatched: Record<string, number>;
  readonly outOfScope: { readonly rooms: number; readonly links: number };
  readonly placement: Plan["counts"];
  readonly assumptions: readonly string[];
  readonly notes: readonly string[];
  readonly issues: readonly Issue[];
}

export interface ImportResult {
  readonly blueprint: Blueprint;
  readonly report: ImportReport;
}

export const DEFAULT_MAX_ENTITIES = 20_000;

function split(
  available: Record<string, number>,
  known: readonly string[],
  ignored: readonly string[],
) {
  const unknown: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  for (const [name, count] of Object.entries(available)) {
    if (ignored.includes(name)) skipped[name] = count;
    else if (!known.includes(name)) unknown[name] = count;
  }
  return { unknown, skipped };
}

/** The answer to a room filter that matches nothing: say what was asked and what could have been. */
function noRoomMatches(asked: readonly string[], names: readonly string[]): string {
  const shown = names.slice(0, 8).join(", ");
  const more = names.length > 8 ? ` 외 ${names.length - 8}곳` : "";
  const known = names.length > 0 ? ` 있는 서버룸: ${shown}${more}` : " 가져올 서버룸이 소스에 없다";
  return `"${asked.join(", ")}"에 맞는 서버룸이 없다. 이름이나 id의 일부를 다시 확인한다.${known}`;
}

/** Drop rooms outside the scope, then whatever no longer connects to anything kept. */
function applyScope(plan: Plan, scope: readonly string[]): { rooms: number; links: number } {
  if (scope.length === 0) return { rooms: 0, links: 0 };
  const wanted = scope.map((s) => s.toLowerCase());
  const keep = (name: string, id: string) =>
    wanted.some((w) => name.toLowerCase().includes(w) || id.includes(w));
  let rooms = 0;
  for (const [id, room] of [...plan.rooms]) {
    if (keep(room.name, id)) continue;
    plan.rooms.delete(id);
    rooms++;
  }
  const physical = new Set(
    [...plan.rooms.values()].flatMap((r) =>
      [...r.racks, ...r.devices, ...r.equipment].map((x) => x.id),
    ),
  );
  const keptVirtual = keptVirtualIds(plan, physical);
  plan.virtual.splice(0, plan.virtual.length, ...plan.virtual.filter((v) => keptVirtual.has(v.id)));
  const alive = new Set([...physical, ...keptVirtual]);
  const before = plan.links.length;
  plan.links.splice(
    0,
    plan.links.length,
    ...plan.links.filter((l) => alive.has(l.from) && alive.has(l.to)),
  );
  return { rooms, links: before - plan.links.length };
}

/** VMs on kept hosts, then clusters, vCenters and datastores those reach. */
function keptVirtualIds(plan: Plan, physical: ReadonlySet<string>): Set<string> {
  const kept = new Set<string>();
  const reach = (kind: LinkKind, fromKept: boolean) => {
    for (const l of plan.links.filter((x) => x.kind === kind))
      if (
        fromKept ? kept.has(l.from) || physical.has(l.from) : physical.has(l.to) || kept.has(l.to)
      )
        kept.add(fromKept ? l.to : l.from);
  };
  reach("runs_on", false);
  reach("member_of", true);
  reach("managed_by", true);
  reach("stored_on", true);
  reach("backed_by", false);
  for (const id of physical) kept.delete(id);
  return kept;
}

function plannedCount(plan: Plan): number {
  const rooms = [...plan.rooms.values()];
  return rooms.reduce(
    (n, r) => n + 1 + r.racks.length + r.devices.length + r.equipment.length,
    plan.virtual.length,
  );
}

function assemble(
  plan: Plan,
  options: ImportOptions,
  catalog: Catalog,
  floorItems: ReturnType<typeof synthesize>["floorItems"],
  meta: Record<string, string>,
) {
  const asm = new BlueprintAssembler(
    options.id ?? "imported",
    options.name ?? "가져온 세계",
    catalog,
    meta,
  );
  asm.site("site", plan.siteName);
  for (const [id, name] of plan.buildings) asm.building(id, "site", name);
  for (const [key, floor] of plan.floors) {
    if (![...plan.rooms.values()].some((r) => r.floorKey === key)) continue;
    asm.floor(floor.id, floor.buildingId, floor.name, floor.level);
    for (const item of floorItems.get(key) ?? []) asm.floorItem(floor.id, item);
  }
  for (const room of plan.rooms.values()) {
    const floor = plan.floors.get(room.floorKey);
    if (floor) asm.room(floor.id, room);
  }
  for (const v of plan.virtual) asm.virtual(v.id, v.kind, v.name, v.props);
  for (const l of plan.links) asm.link(l.kind, l.from, l.to, l.props);
  return asm.build();
}

function counts<T extends string>(items: readonly { kind: T }[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const item of items) out[item.kind] = (out[item.kind] ?? 0) + 1;
  return out;
}

/** Keep only the asked-for rooms. Asking for rooms that do not exist is an error that lists the ones that do. */
function scopeToRooms(plan: Parameters<typeof applyScope>[0], rooms: readonly string[]) {
  const roomNames = [...plan.rooms.values()].map((r) => r.name);
  const outOfScope = applyScope(plan, rooms);
  if (rooms.length > 0 && plan.rooms.size === 0)
    throw new InvalidValueError(noRoomMatches(rooms, roomNames));
  return outOfScope;
}

export async function importReality(
  source: RealitySource,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const mapping = options.mapping ?? CLOUD_TOPOLOGY_MAPPING;
  const catalog = options.catalog ?? new Catalog();
  const pageSize = options.pageSize ?? 500;
  const summary = await source.summary();
  const labels = mappedLabels(mapping).filter((l) => summary.labels[l]);
  const types = mappedRelations(mapping).filter((t) => summary.relationships[t]);
  const nodes = (
    await Promise.all(labels.map((l) => readAll((p) => source.nodes(l, p), pageSize)))
  ).flat();
  const rels = (
    await Promise.all(types.map((t) => readAll((p) => source.relationships(t, p), pageSize)))
  ).flat();
  const classification = classify(mapping, nodes, rels);
  const plan = resolve(classification, mapping, catalog, options.siteName ?? "현실 사업장");
  const outOfScope = scopeToRooms(plan, options.rooms ?? []);
  const size = plannedCount(plan);
  const max = options.maxEntities ?? DEFAULT_MAX_ENTITIES;
  if (size > max)
    throw new InvalidValueError(
      `가져올 대상이 ${size}개로 너무 많다 (최대 ${max}개). 가져올 서버룸 범위를 좁혀라`,
    );
  const synthesis = synthesize(plan, catalog, {
    power: options.assume?.power ?? true,
    cooling: options.assume?.cooling ?? true,
  });
  const built = assemble(plan, options, catalog, synthesis.floorItems, {
    source: "realimport",
    from: source.name,
    mapping: mapping.name,
  });
  const labelSplit = split(summary.labels, mappedLabels(mapping), mapping.ignoredLabels);
  const relSplit = split(summary.relationships, mappedRelations(mapping), mapping.ignoredRelations);
  return {
    blueprint: built.blueprint,
    report: {
      source: source.name,
      mapping: mapping.name,
      available: { labels: { ...summary.labels }, relationships: { ...summary.relationships } },
      entities: counts(built.blueprint.entities),
      links: counts(built.blueprint.links),
      unknown: { labels: labelSplit.unknown, relationships: relSplit.unknown },
      ignored: { labels: labelSplit.skipped, relationships: relSplit.skipped },
      filteredOut: { ...classification.filteredOut },
      unmatched: { ...classification.unmatched },
      outOfScope,
      placement: plan.counts,
      assumptions: synthesis.assumptions,
      notes: built.notes,
      issues: built.issues,
    },
  };
}
