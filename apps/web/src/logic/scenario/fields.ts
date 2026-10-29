/**
 * The block inspector's form (REQ-034): for each parameter of a block, what kind of control it is,
 * what it may be set to in this world, and what it is set to now. Entity choices are the world's own
 * equipment, grouped by where it stands, so people pick "랙 3의 서버 12", not an id.
 */
import {
  blockSpec,
  COMPARE_OPS,
  CONDITION_FIELDS,
  type CompareOp,
  type Condition,
  type ParamSpec,
  type ParamValue,
  type ScenarioDoc,
  type ScenarioNode,
} from "@terrarium/core/scenario";
import {
  type BlueprintIndex,
  type EntityKind,
  FAULT_SPECS,
  type FaultSpec,
  faultSpec,
  isFaultType,
  KIND_LABELS,
} from "@terrarium/core/world";

export interface Choice {
  readonly value: string;
  readonly label: string;
  /** Where it stands, for grouping long lists. */
  readonly group?: string;
  readonly disabled?: boolean;
}

interface FieldBase {
  readonly name: string;
  readonly label: string;
  readonly help?: string;
  readonly optional: boolean;
}

export type Field = FieldBase &
  (
    | {
        readonly control: "number";
        readonly min: number;
        readonly max: number;
        readonly unit: string;
        readonly step: number;
        readonly value: number | undefined;
      }
    | {
        readonly control: "choice";
        readonly choices: readonly Choice[];
        readonly value: string | undefined;
      }
    | {
        readonly control: "text";
        readonly maxLength: number;
        readonly multiline: boolean;
        readonly value: string;
      }
    | { readonly control: "toggle"; readonly value: boolean }
    | { readonly control: "condition"; readonly value: Condition | undefined }
    | { readonly control: "numbers"; readonly items: readonly NumberItem[] }
  );

export interface NumberItem {
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly unit: string;
  readonly value: number;
}

/** Where an entity stands: "서버룸 A, 랙 3", or "가상" for virtual things. */
function placeOf(index: BlueprintIndex, id: string): string {
  const names = index
    .ancestors(id)
    .filter((e) => e.kind === "room" || e.kind === "rack")
    .reverse()
    .map((e) => e.name);
  return names.join(", ") || "가상";
}

export function entityChoices(
  index: BlueprintIndex,
  kinds: readonly (EntityKind | "link")[],
): Choice[] {
  const out: Choice[] = [];
  for (const kind of kinds) {
    if (kind === "link") {
      for (const l of index.allLinks().filter((x) => x.kind === "network"))
        out.push({
          value: l.id,
          label: `${index.find(l.from)?.name ?? l.from} → ${index.find(l.to)?.name ?? l.to}`,
          group: "네트워크 링크",
        });
      continue;
    }
    for (const e of index.ofKind(kind))
      out.push({
        value: e.id,
        label: e.name,
        group: `${placeOf(index, e.id)}의 ${KIND_LABELS[kind]}`,
      });
  }
  return out.sort(
    (a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label, "ko"),
  );
}

const faultOf = (node: ScenarioNode): FaultSpec | undefined => {
  const t = node.params.faultType;
  return typeof t === "string" && isFaultType(t) ? faultSpec(t) : undefined;
};

function numberField(
  base: FieldBase,
  spec: Extract<ParamSpec, { kind: "number" }>,
  value: ParamValue | undefined,
): Field {
  return {
    ...base,
    control: "number",
    min: spec.min,
    max: spec.max,
    unit: spec.unit,
    step: spec.integer ? 1 : spec.max - spec.min <= 1 ? 0.05 : 0.5,
    value: typeof value === "number" ? value : undefined,
  };
}

function faultParams(base: FieldBase, node: ScenarioNode): Field {
  const fault = faultOf(node);
  const current = (
    typeof node.params[base.name] === "object" ? node.params[base.name] : {}
  ) as Record<string, number>;
  return {
    ...base,
    control: "numbers",
    items: (fault?.params ?? []).map((p) => ({
      name: p.name,
      label: p.label,
      min: p.min,
      max: p.max,
      unit: p.unit,
      value: typeof current[p.name] === "number" ? (current[p.name] as number) : p.default,
    })),
  };
}

interface FieldCtx {
  readonly base: FieldBase;
  readonly value: ParamValue | undefined;
  readonly node: ScenarioNode;
  readonly doc: ScenarioDoc;
  readonly index: BlueprintIndex;
}

type Builders = {
  readonly [K in ParamSpec["kind"]]: (spec: Extract<ParamSpec, { kind: K }>, c: FieldCtx) => Field;
};

const strOf = (v: ParamValue | undefined) => (typeof v === "string" ? v : undefined);

const choice = (c: FieldCtx, choices: readonly Choice[]): Field => ({
  ...c.base,
  control: "choice",
  choices,
  value: strOf(c.value),
});

/** One maker per parameter kind; adding a kind to core fails the type check here until it has one. */
const BUILDERS: Builders = {
  number: (spec, c) => numberField(c.base, spec, c.value),
  entity: (spec, c) => choice(c, entityChoices(c.index, spec.kinds)),
  fault_type: (_spec, c) =>
    choice(
      c,
      FAULT_SPECS.map((f) => ({
        value: f.type,
        label: f.label,
        disabled: f.status !== "supported",
      })),
    ),
  fault_target: (_spec, c) => choice(c, entityChoices(c.index, faultOf(c.node)?.targets ?? [])),
  fault_params: (_spec, c) => faultParams(c.base, c.node),
  text: (spec, c) => ({
    ...c.base,
    control: "text",
    maxLength: spec.maxLength,
    multiline: spec.multiline ?? false,
    value: strOf(c.value) ?? "",
  }),
  boolean: (_spec, c) => ({ ...c.base, control: "toggle", value: c.value === true }),
  condition: (_spec, c) => ({
    ...c.base,
    control: "condition",
    value: typeof c.value === "object" ? (c.value as Condition) : undefined,
  }),
  node_ref: (spec, c) =>
    choice(
      c,
      c.doc.nodes
        .filter((n) => n.type === spec.nodeType)
        .map((n) => ({
          value: n.id,
          label: n.label ?? `${n.id} (${faultOf(n)?.label ?? "장애"})`,
        })),
    ),
};

function fieldOf(
  spec: ParamSpec,
  node: ScenarioNode,
  doc: ScenarioDoc,
  index: BlueprintIndex,
): Field {
  const base: FieldBase = {
    name: spec.name,
    label: spec.label,
    optional: spec.optional ?? false,
    ...(spec.help ? { help: spec.help } : {}),
  };
  const build = BUILDERS[spec.kind] as (s: ParamSpec, c: FieldCtx) => Field;
  return build(spec, { base, value: node.params[spec.name], node, doc, index });
}

/** The form for one block, in the order its parameters are declared. */
export function fieldsOf(doc: ScenarioDoc, nodeId: string, index: BlueprintIndex): Field[] {
  const node = doc.nodes.find((n) => n.id === nodeId);
  const spec = node ? blockSpec(node.type) : undefined;
  if (!node || !spec) return [];
  return spec.params.map((p) => fieldOf(p, node, doc, index));
}

/** A number typed into a field, clamped to what the field allows; undefined for an empty box. */
export function readNumber(
  text: string,
  field: { min: number; max: number; step: number },
): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.min(field.max, Math.max(field.min, n));
  return field.step >= 1 ? Math.round(clamped) : clamped;
}

// ── conditions ─────────────────────────────────────────────────────────────────────────────

export const CONDITION_KIND_LABELS: Readonly<Record<Condition["kind"], string>> = {
  state: "장비 상태",
  alarm: "알람",
  tool_called: "에이전트가 툴을 불렀다",
  action_taken: "에이전트가 조치했다",
  diagnosis_submitted: "에이전트가 진단을 냈다",
  all: "모두 참",
  any: "하나라도 참",
};

export const OP_LABELS: Readonly<Record<CompareOp, string>> = {
  "<": "보다 작다",
  "<=": "이하",
  ">": "보다 크다",
  ">=": "이상",
  "==": "같다",
  "!=": "다르다",
};
export { COMPARE_OPS };

/** The state fields a condition can test on an entity, e.g. a rack's inlet temperature. */
export function stateFields(index: BlueprintIndex, entityId: string): Choice[] {
  const kind = index.find(entityId)?.kind;
  if (!kind) return [];
  return Object.entries(CONDITION_FIELDS[kind]).map(([value, spec]) => ({
    value,
    label: spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
  }));
}

/** A sensible new condition of a kind, ready to edit. */
export function newCondition(kind: Condition["kind"], index: BlueprintIndex): Condition {
  const first = index.ofKind("rack")[0] ?? index.all().find((e) => e.kind === "server");
  switch (kind) {
    case "state":
      return {
        kind,
        entity: first?.id ?? "",
        field: first?.kind === "rack" ? "inletC" : "health",
        op: ">",
        value: 30,
      };
    case "alarm":
      return { kind, active: true, severity: "critical" };
    case "tool_called":
      return { kind, tool: "list_alarms" };
    case "action_taken":
      return { kind, action: "power_off" };
    case "diagnosis_submitted":
      return { kind };
    case "all":
    case "any":
      return { kind, of: [] };
  }
}
