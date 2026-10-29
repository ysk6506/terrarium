/**
 * Editing a condition without writing one: pick what to ask about (a device's state, an alarm, what the
 * agent did), then fill in the blanks. "All" and "any" hold up to three levels of sub-conditions.
 */
import {
  ACTION_KINDS,
  ACTION_LABELS,
  type ActionKind,
  type CompareOp,
  type Condition,
  describeCondition,
} from "@terrarium/core/scenario";
import { TOOL_SPECS } from "@terrarium/core/tools";
import type { BlueprintIndex } from "@terrarium/core/world";
import { scenario } from "../../logic";
import { Button, NumberField, SelectField, TextField } from "../kit";

const KIND_OPTIONS = (Object.keys(scenario.CONDITION_KIND_LABELS) as Condition["kind"][]).map(
  (k) => ({
    value: k,
    label: scenario.CONDITION_KIND_LABELS[k],
  }),
);
const ACTION_OPTIONS = ACTION_KINDS.map((a) => ({ value: a, label: ACTION_LABELS[a] }));
const TOOL_OPTIONS = TOOL_SPECS.map((t) => ({ value: t.name, label: t.title }));
const OP_OPTIONS = scenario.COMPARE_OPS.map((op) => ({
  value: op,
  label: `${op} (${scenario.OP_LABELS[op]})`,
}));
const ANY_ENTITY = "";

interface Props {
  readonly value: Condition;
  readonly onChange: (c: Condition) => void;
  readonly index: BlueprintIndex;
  readonly depth?: number;
}

function targetChoices(index: BlueprintIndex) {
  return [
    { value: ANY_ENTITY, label: "아무 대상이나" },
    ...scenario.entityChoices(index, [
      "server",
      "rack",
      "pdu",
      "power_panel",
      "ups",
      "cooling_unit",
      "switch",
      "storage",
      "vm",
    ]),
  ];
}

function StateFields({
  value,
  onChange,
  index,
}: Props & { readonly value: Extract<Condition, { kind: "state" }> }) {
  const fields = scenario.stateFields(index, value.entity);
  const numeric = typeof value.value === "number";
  return (
    <>
      <SelectField
        label="장비"
        value={value.entity}
        options={scenario.entityChoices(index, [
          "rack",
          "server",
          "room",
          "cooling_unit",
          "pdu",
          "power_panel",
          "ups",
          "switch",
          "storage",
          "vm",
        ])}
        onChange={(entity) =>
          onChange({
            ...value,
            entity,
            field: scenario.stateFields(index, entity)[0]?.value ?? value.field,
          })
        }
      />
      <SelectField
        label="값"
        value={value.field}
        options={fields}
        onChange={(field) => onChange({ ...value, field })}
      />
      <SelectField
        label="비교"
        value={value.op}
        options={OP_OPTIONS}
        onChange={(op) => onChange({ ...value, op: op as CompareOp })}
      />
      {numeric ? (
        <NumberField
          label="기준"
          value={value.value as number}
          onChange={(n) => n !== undefined && onChange({ ...value, value: n })}
        />
      ) : (
        <TextField
          label="기준"
          value={String(value.value)}
          onChange={(v) =>
            onChange({ ...value, value: v === "true" ? true : v === "false" ? false : v })
          }
        />
      )}
    </>
  );
}

function AlarmFields({
  value,
  onChange,
  index,
}: Props & { readonly value: Extract<Condition, { kind: "alarm" }> }) {
  return (
    <>
      <SelectField
        label="있는가, 없는가"
        value={value.active ? "on" : "off"}
        options={[
          { value: "on", label: "울리고 있다" },
          { value: "off", label: "울리지 않는다" },
        ]}
        onChange={(v) => onChange({ ...value, active: v === "on" })}
      />
      <SelectField
        label="심각도"
        value={value.severity ?? ""}
        options={[
          { value: "", label: "아무거나" },
          { value: "critical", label: "위험" },
          { value: "warning", label: "주의" },
        ]}
        onChange={(v) => {
          const { severity: _s, ...rest } = value;
          onChange(v ? { ...rest, severity: v as "warning" | "critical" } : rest);
        }}
      />
      <SelectField
        label="장비"
        value={value.entity ?? ANY_ENTITY}
        options={targetChoices(index)}
        onChange={(v) => {
          const { entity: _e, ...rest } = value;
          onChange(v ? { ...rest, entity: v } : rest);
        }}
      />
    </>
  );
}

function withTarget<T extends { readonly target?: string }>(value: T, target: string): T {
  const { target: _t, ...rest } = value;
  return (target ? { ...rest, target } : rest) as T;
}

function AgentFields({ value, onChange, index }: Props) {
  if (value.kind === "tool_called")
    return (
      <>
        <SelectField
          label="툴"
          value={value.tool}
          options={TOOL_OPTIONS}
          onChange={(tool) => onChange({ ...value, tool })}
        />
        <SelectField
          label="대상"
          value={value.target ?? ANY_ENTITY}
          options={targetChoices(index)}
          onChange={(t) => onChange(withTarget(value, t))}
        />
      </>
    );
  if (value.kind === "action_taken")
    return (
      <>
        <SelectField
          label="조치"
          value={value.action}
          options={ACTION_OPTIONS}
          onChange={(a) => onChange({ ...value, action: a as ActionKind })}
        />
        <SelectField
          label="대상"
          value={value.target ?? ANY_ENTITY}
          options={targetChoices(index)}
          onChange={(t) => onChange(withTarget(value, t))}
        />
      </>
    );
  return null;
}

function GroupFields({
  value,
  onChange,
  index,
  depth = 0,
}: Props & { readonly value: Extract<Condition, { kind: "all" | "any" }> }) {
  const set = (i: number, c: Condition) =>
    onChange({ ...value, of: value.of.map((x, j) => (j === i ? c : x)) });
  return (
    <div
      className="stack"
      style={{ gap: 10, paddingLeft: 10, borderLeft: "2px solid var(--line)" }}
    >
      {value.of.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: sub-conditions have no ids; their place is their identity
        <div key={i} className="stack" style={{ gap: 6 }}>
          <ConditionEditor
            value={c}
            onChange={(next) => set(i, next)}
            index={index}
            depth={depth + 1}
          />
          <Button
            size="small"
            kind="quiet"
            icon="close"
            onClick={() => onChange({ ...value, of: value.of.filter((_, j) => j !== i) })}
          >
            이 조건 빼기
          </Button>
        </div>
      ))}
      {depth < 2 && (
        <Button
          size="small"
          icon="plus"
          onClick={() =>
            onChange({ ...value, of: [...value.of, scenario.newCondition("alarm", index)] })
          }
        >
          조건 더하기
        </Button>
      )}
    </div>
  );
}

export function ConditionEditor({ value, onChange, index, depth = 0 }: Props) {
  const kinds =
    depth >= 2 ? KIND_OPTIONS.filter((k) => k.value !== "all" && k.value !== "any") : KIND_OPTIONS;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <SelectField
        label="무엇을 묻나"
        value={value.kind}
        options={kinds}
        onChange={(k) => onChange(scenario.newCondition(k as Condition["kind"], index))}
      />
      {value.kind === "state" && <StateFields value={value} onChange={onChange} index={index} />}
      {value.kind === "alarm" && <AlarmFields value={value} onChange={onChange} index={index} />}
      <AgentFields value={value} onChange={onChange} index={index} />
      {(value.kind === "all" || value.kind === "any") && (
        <GroupFields value={value} onChange={onChange} index={index} depth={depth} />
      )}
      {depth === 0 && <p className="tiny muted">{describeCondition(value, index)}</p>}
    </div>
  );
}
