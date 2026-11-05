/**
 * A blueprint that has been checked and indexed once, to be shared by every world built from it on this
 * thread. Validating and indexing a big blueprint costs tens to hundreds of milliseconds and megabytes,
 * and the result never changes (the blueprint is read-only, ADR-0006), so runs of one world need not
 * each do it again.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError } from "@terrarium/core/kernel";
import type { Blueprint } from "./blueprint";
import { blueprintDigest } from "./digest";
import { BlueprintIndex } from "./graph";
import { hasErrors, validateBlueprint } from "./validate";

export interface PreparedWorld {
  readonly blueprint: Blueprint;
  readonly index: BlueprintIndex;
  /** The world's semantic digest (see `blueprintDigest`); worlds sharing it share their warm start. */
  readonly digest: string;
}

/** Check a blueprint against the catalog and index it; refuses an invalid one with every error listed. */
export function prepareWorld(
  blueprint: Blueprint,
  catalog: Catalog,
  digest: string = blueprintDigest(blueprint),
): PreparedWorld {
  const issues = validateBlueprint(blueprint, catalog);
  if (hasErrors(issues)) {
    const errors = issues
      .filter((i) => i.severity === "error")
      .map((i) => `${i.code} ${i.message}`);
    throw new InvalidValueError(`blueprint ${blueprint.id} is invalid: ${errors.join("; ")}`);
  }
  return { blueprint, index: new BlueprintIndex(blueprint), digest };
}
