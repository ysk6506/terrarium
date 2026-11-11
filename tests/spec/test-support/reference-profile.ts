/**
 * Does the reference solution still score 100 on a physics profile? (REQ-113, ADR-0137, docs/design-docs/physics-laws.md)
 * A profile that makes a room heat much faster can leave a sheet that nobody can finish in the expected time; such a sheet
 * is "만점 불가" on that physics and is left out of that profile's benchmark. The hook runs the reference solver of
 * REQ-110 on every sheet in a world carrying the profile and lists the sheets that fall short.
 */
import type { PhysicsProfile } from "@terrarium/core/physics/slots";
import { referenceCases } from "./reference-cases";
import { solve } from "./reference-solver";

export interface ProfileFinding {
  readonly label: string;
  readonly total: number;
  /** The parts of the score that were not full, `id points/max`. */
  readonly short: readonly string[];
}

export interface ProfileCheck {
  /** How many sheets were played. */
  readonly checked: number;
  /** Sheets where the reference does not reach 100: no full marks on this physics. */
  readonly failing: readonly ProfileFinding[];
}

export interface ProfileCheckOptions {
  /** Play only the sheets this says yes to (by label); left out, every sheet. */
  readonly only?: (label: string) => boolean;
}

export function validateProfileAgainstReference(
  profile: PhysicsProfile,
  options: ProfileCheckOptions = {},
): ProfileCheck {
  const failing: ProfileFinding[] = [];
  let checked = 0;
  for (const c of referenceCases()) {
    if (options.only && !options.only(c.label)) continue;
    checked++;
    const { result } = solve({ ...c.blueprint, physics: profile }, c.doc());
    const score = result.score;
    const short = score.items
      .filter((i) => i.points < i.max)
      .map((i) => `${i.id} ${i.points}/${i.max}`);
    if ((score.total ?? 0) < 100 || short.length > 0)
      failing.push({ label: c.label, total: score.total ?? 0, short });
  }
  return { checked, failing };
}
