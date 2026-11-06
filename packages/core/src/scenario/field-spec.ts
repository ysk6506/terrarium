/** The fields a condition can test, and the small makers the tables of them use (REQ-034). */
/** A field a condition can test, with how people read it. */
export interface FieldSpec {
  readonly label: string;
  readonly type: "number" | "boolean" | "enum";
  readonly unit?: string;
  readonly values?: readonly string[];
}

export const num = (label: string, unit: string): FieldSpec => ({ label, type: "number", unit });
export const bool = (label: string): FieldSpec => ({ label, type: "boolean" });
export const version = (label: string): FieldSpec => ({ label, type: "enum" });
export const HEALTH: FieldSpec = {
  label: "상태",
  type: "enum",
  values: ["ok", "warning", "critical"],
};
