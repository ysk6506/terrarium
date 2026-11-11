/**
 * Every sheet the reference solution is held to (REQ-110, ADR-0133): each built-in template in the world it fits, the
 * four modes of a site, and a probe sheet for each fault kind no template injects.
 */

import type { ScenarioDoc } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { kindCases } from "./kind-sheets";
import { type Case, operatorCases, siteModeCases } from "./operator-worlds";

export interface RefCase extends Case {
  readonly label: string;
  readonly doc: () => ScenarioDoc;
}

let cache: RefCase[] | undefined;

export function referenceCases(): RefCase[] {
  if (cache) return cache;
  const all = [
    ...operatorCases(),
    ...siteModeCases().filter((c) => c.world !== "warm" && c.world !== "cold"),
  ];
  const named = all.map((c) => ({
    ...c,
    label: c.world === "fallback 0" || c.world === "explicit" ? c.id : `${c.id} [${c.world}]`,
  }));
  const kinds = kindCases().map((c) => ({ ...c, label: `${c.id} [${c.world}]` }));
  cache = [...named, ...kinds].map((c) => ({
    ...(c as Case),
    label: c.label,
    doc: () => c.template.build(new BlueprintIndex(c.blueprint), "lab"),
  }));
  return cache;
}
