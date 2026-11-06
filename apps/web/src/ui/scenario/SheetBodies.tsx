/** The detail forms behind a sentence of the scoring sheet: which equipment, which fault, which action, which state. */
import {
  ACTION_KINDS,
  ACTION_LABELS,
  type ActionKind,
  type Expectation,
} from "@terrarium/core/scenario";
import { FAULT_SPECS } from "@terrarium/core/world";
import { scenario } from "../../logic";
import { NumberField, type Option, SelectField, TextField } from "../kit";
import { ConditionEditor } from "./ConditionEditor";
import type { ScenarioEditor } from "./useScenario";

const ACTIONS: Option[] = ACTION_KINDS.map((a) => ({ value: a, label: ACTION_LABELS[a] }));
const FAULTS: Option[] = FAULT_SPECS.map((f) => ({ value: f.type, label: f.label }));
const ANY = "";

/** Several values picked one at a time, shown as removable chips. */
function MultiPick(props: {
  readonly label: string;
  readonly values: readonly string[];
  readonly options: readonly Option[];
  readonly onChange: (v: string[]) => void;
}) {
  const name = (v: string) => props.options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <SelectField
        label={props.label}
        value={undefined}
        placeholder="더할 것을 골라요"
        options={props.options.filter((o) => !props.values.includes(o.value))}
        onChange={(v) => props.onChange([...props.values, v])}
      />
      {props.values.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {props.values.map((v) => (
            <span key={v} className="tag">
              {name(v)}
              <button
                type="button"
                className="link-button"
                aria-label={`${name(v)} 빼기`}
                onClick={() => props.onChange(props.values.filter((x) => x !== v))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A chosen target, or none ("아무 대상이나"). */
const targetOf = (target: string) => ({ target: target || undefined }) as Partial<Expectation>;

export interface BodyProps {
  readonly x: Expectation;
  readonly e: ScenarioEditor;
  readonly set: (c: Partial<Expectation>) => void;
}

const TARGET_KINDS = [
  "server",
  "rack",
  "pdu",
  "power_panel",
  "ups",
  "cooling_unit",
  "switch",
  "storage",
  "vm",
] as const;

const targetsOf = (e: ScenarioEditor): Option[] => [
  { value: ANY, label: "아무 대상이나" },
  ...scenario.entityChoices(e.index, [...TARGET_KINDS]),
];

function DiagnosisBody({
  x,
  e,
  set,
}: BodyProps & { readonly x: Extract<Expectation, { kind: "diagnosis" }> }) {
  return (
    <>
      <MultiPick
        label="맞는 원인 장비 (하나라도 맞으면 정답)"
        values={x.rootCause}
        options={targetsOf(e).slice(1)}
        onChange={(rootCause) => set({ rootCause })}
      />
      <MultiPick
        label="맞는 고장 종류"
        values={x.faultType}
        options={FAULTS}
        onChange={(faultType) => set({ faultType })}
      />
    </>
  );
}

function FinalStateBody({
  x,
  e,
  set,
}: BodyProps & { readonly x: Extract<Expectation, { kind: "final_state" }> }) {
  return (
    <>
      <TextField
        label="결과에 보일 설명"
        value={x.label ?? ""}
        maxLength={200}
        onChange={(label) => set({ label })}
      />
      <ConditionEditor
        value={x.condition}
        onChange={(condition) => set({ condition })}
        index={e.index}
      />
    </>
  );
}

function ActionBody({
  x,
  e,
  set,
}: BodyProps & {
  readonly x: Extract<Expectation, { kind: "required_action" | "forbidden_action" }>;
}) {
  return (
    <>
      <SelectField
        label="조치"
        value={x.action}
        options={ACTIONS}
        onChange={(a) => set({ action: a as ActionKind })}
      />
      <SelectField
        label="대상"
        value={x.target ?? ANY}
        options={targetsOf(e)}
        onChange={(t) => set(targetOf(t))}
      />
    </>
  );
}

export function Body({ x, e, set }: BodyProps) {
  switch (x.kind) {
    case "diagnosis":
      return <DiagnosisBody x={x} e={e} set={set} />;
    case "final_state":
      return <FinalStateBody x={x} e={e} set={set} />;
    case "required_action":
    case "forbidden_action":
      return <ActionBody x={x} e={e} set={set} />;
    case "time_limit":
      return (
        <NumberField
          label="제한 시간"
          value={Math.round(x.seconds / 60)}
          min={1}
          max={600}
          unit="분"
          onChange={(m) => m !== undefined && set({ seconds: m * 60 })}
        />
      );
    case "tool_budget":
      return (
        <NumberField
          label="툴 호출 상한"
          value={x.maxCalls}
          min={1}
          max={500}
          unit="회"
          onChange={(n) => n !== undefined && set({ maxCalls: n })}
        />
      );
  }
}
