/**
 * Things a person saved under a name to use again (ADR-0092 item 3, ADR-0112): an operation instruction, a tool set or
 * a runbook. They belong to the person, not to a world or a scenario. A deleted one can be brought back for a week.
 */
export type PresetKind = "instruction" | "toolset" | "runbook";

export const PRESET_KINDS: readonly PresetKind[] = ["instruction", "toolset", "runbook"];

export interface PresetRecord {
  readonly id: string;
  readonly owner: string;
  readonly kind: PresetKind;
  readonly name: string;
  /** The text of an instruction; the JSON of a tool-name list or of a runbook. */
  readonly body: string;
  readonly createdAt: string;
  /** Changed when saved again under the same name or renamed; absent until then. */
  readonly updatedAt?: string;
  /** Set when deleted; the record is kept for `PRESET_UNDO_DAYS` and then removed. */
  readonly deletedAt?: string;
}

export const PRESET_UNDO_DAYS = 7;
export const PRESET_NAME_MAX = 40;
export const PRESET_BODY_MAX = 64_000;
