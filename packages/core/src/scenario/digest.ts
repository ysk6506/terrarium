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
    // only where it is set, so the digest of every sheet scored as written stays what it was
    ...(doc.scoring ? { scoring: doc.scoring } : {}),
    // the window of the time points decides the score, so a different expected recovery is a different sheet (REQ-108)
    ...(doc.expectedRecoveryS !== undefined ? { expectedRecoveryS: doc.expectedRecoveryS } : {}),
    // the runbook can change what an agent does and how SOP compliance is read, so it is part of the version
    ...(doc.runbook ? { runbook: doc.runbook } : {}),
  });
}
