/** What the alarm rules read, and how a rule's hits become alarms. */
import type { Alarm, Entity, World } from "@terrarium/core/world";
import type { Pass } from "./power";

export type Draft = Omit<Alarm, "id" | "since">;

/** What a scan of the world reads: the world itself and its entities by position. */
export interface Scan extends Pass {
  readonly world: World;
}

export type Hit = [code: string, severity: Alarm["severity"], message: string];
export const NO_HITS: readonly Hit[] = Object.freeze([]);

/** Add the alarms of `hits` for an entity. */
export function pushHits(out: Draft[], entity: Entity, hits: readonly Hit[]): void {
  for (const [code, severity, message] of hits)
    out.push({ entityId: entity.id, code, severity, message });
}
