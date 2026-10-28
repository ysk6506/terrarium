/**
 * The scenario's semantic version, part of the benchmark key (REQ-039). Only what changes behaviour or
 * scoring counts: moving blocks, renaming the scenario or captioning blocks keeps the digest, so a
 * cosmetic edit does not split a benchmark set.
 */
import { hashValue } from "@terrarium/core/kernel";
import type { ScenarioDoc } from "./model";

const byId = <T extends { readonly id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export function scenarioDigest(doc: ScenarioDoc): string {
  return hashValue({
    schemaVersion: doc.schemaVersion,
    nodes: [...doc.nodes].sort(byId).map((n) => ({ id: n.id, type: n.type, params: n.params })),
    edges: doc.edges
      .map((e) => `${e.from}:${e.port}->${e.to}`)
      .sort()
      .filter((e, i, all) => all.indexOf(e) === i),
    expectations: [...doc.expectations].sort(byId).map(({ label: _label, ...rest }) => rest),
  });
}
