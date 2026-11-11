/** The slots as a list a screen can show (REQ-113): each slot with its numbers and tables, units, defaults and ranges. */

import { PHYSICS_BASES } from "./profile";
import { SLOTS } from "./registry";
import type { CurveSpec, FieldSpec, ParamSpec, ScopeKind, SlotId } from "./types";

export interface SlotView {
  readonly id: SlotId;
  readonly ko: string;
  readonly scopes: readonly ScopeKind[];
  readonly input: readonly FieldSpec[];
  readonly output: readonly FieldSpec[];
  readonly v1: string;
  /** `name` is the part after the slot id; a profile uses `id.name`. */
  readonly params: ReadonlyArray<ParamSpec & { readonly name: string }>;
  readonly curves: ReadonlyArray<CurveSpec & { readonly name: string }>;
}

export interface SlotsView {
  /** The default physics versions a profile may stand on. */
  readonly bases: readonly string[];
  readonly slots: readonly SlotView[];
}

export function describeSlots(): SlotsView {
  return {
    bases: PHYSICS_BASES,
    slots: Object.values(SLOTS).map((s) => ({
      id: s.id,
      ko: s.ko,
      scopes: s.scopes,
      input: s.input,
      output: s.output,
      v1: s.v1,
      params: Object.entries(s.params).map(([name, p]) => ({ name, ...p })),
      curves: Object.entries(s.curves).map(([name, c]) => ({ name, ...c })),
    })),
  };
}
