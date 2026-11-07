/**
 * 멈추면 시간당 피해 (REQ-104, ADR-0127): the damage numbers left the world screens; a person who presses 바꾸기 changes
 * them on the experiment form. They live on the world's service entities (`harmTiers`, and `harmPerHourKrw` as the
 * biggest of them), so a change is written back to the world before the experiment is made.
 */
import type { Blueprint, Entity } from "@terrarium/core/world";

export interface HarmRow {
  readonly entityId: string;
  readonly service: string;
  readonly tiers: ReadonlyArray<{ readonly name: string; readonly perHourKrw: number }>;
}

function tiersOf(e: Entity): HarmRow["tiers"] | undefined {
  const raw = e.props.harmTiers;
  if (typeof raw !== "string") return undefined;
  try {
    const list = JSON.parse(raw) as Array<{ name?: unknown; perHourKrw?: unknown }>;
    return list.flatMap((t) =>
      typeof t.name === "string" && typeof t.perHourKrw === "number"
        ? [{ name: t.name, perHourKrw: t.perHourKrw }]
        : [],
    );
  } catch {
    return undefined;
  }
}

/** The services of a shaped world with the ways they stop and what an hour of each costs. */
export function harmRows(blueprint: Blueprint): HarmRow[] {
  return blueprint.entities.flatMap((e) => {
    const tiers = e.kind === "service" ? tiersOf(e) : undefined;
    return tiers && tiers.length > 0 ? [{ entityId: e.id, service: e.name, tiers }] : [];
  });
}

/** The blueprint with new numbers (per entity, in the tiers' order); other entities are untouched. */
export function withHarm(
  blueprint: Blueprint,
  edits: Readonly<Record<string, readonly number[]>>,
): Blueprint {
  return {
    ...blueprint,
    entities: blueprint.entities.map((e) => {
      const nums = edits[e.id];
      const tiers = nums ? tiersOf(e) : undefined;
      if (!nums || !tiers) return e;
      const next = tiers.map((t, i) => ({ ...t, perHourKrw: nums[i] ?? t.perHourKrw }));
      const top = next.reduce((m, t) => Math.max(m, t.perHourKrw), 0);
      return {
        ...e,
        props: {
          ...e.props,
          harmTiers: JSON.stringify(next),
          ...(e.props.harmPerHourKrw !== undefined ? { harmPerHourKrw: top } : {}),
        },
      };
    }),
  };
}
