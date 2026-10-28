/**
 * The world's semantic version, part of the benchmark key (REQ-039). Everything an agent could notice
 * counts (entities, names, models, placement, links); only the blueprint's own id, name and import
 * metadata do not, so a copied or renamed world stays in the same benchmark set.
 */
import { hashValue } from "@terrarium/core/kernel";
import type { Blueprint } from "./blueprint";

const byId = <T extends { readonly id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export function blueprintDigest(bp: Blueprint): string {
  return hashValue({
    schemaVersion: bp.schemaVersion,
    entities: [...bp.entities].sort(byId),
    links: [...bp.links].sort(byId),
  });
}
