/**
 * The scoring sheet (REQ-034, ADR-0016): what earns points and what costs them, one card per line,
 * with the total kept in view so people can aim for 100 without doing sums.
 */
import {
  ACTION_KINDS,
  ACTION_LABELS,
  type ActionKind,
  type Expectation,
  type ExpectationKind,
} from "@terrarium/core/scenario";
import { FAULT_SPECS } from "@terrarium/core/world";
import { scenario } from "../../logic";
import { Button, MenuButton, NumberField, type Option, SelectField, TextField } from "../kit";
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
        placeholder="더할 것을 고른다"
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

interface BodyProps {
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

function Body({ x, e, set }: BodyProps) {
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

function Card({ x, e }: { readonly x: Expectation; readonly e: ScenarioEditor }) {
  const set = (change: Partial<Expectation>) =>
    e.change((d) => scenario.updateExpectation(d, x.id, change));
  const issues = e.issues.filter((i) => i.expectationId === x.id);
  return (
    <section className="panel panel-pad stack" aria-label={scenario.EXPECTATION_LABELS[x.kind]}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>{scenario.EXPECTATION_LABELS[x.kind]}</h3>
        <Button
          size="small"
          kind="quiet"
          icon="trash"
          aria-label="이 항목 지우기"
          onClick={() => e.change((d) => scenario.removeExpectation(d, x.id))}
        />
      </div>
      <Body x={x} e={e} set={set} />
      {"weight" in x ? (
        <NumberField
          label="점수"
          value={x.weight}
          min={0}
          max={100}
          unit="점"
          onChange={(w) => w !== undefined && set({ weight: w })}
        />
      ) : (
        <NumberField
          label="한 번마다 깎는 점수"
          value={x.penalty}
          min={0}
          max={100}
          unit="점"
          onChange={(p) => p !== undefined && set({ penalty: p } as Partial<Expectation>)}
        />
      )}
      <p className="tiny muted">{scenario.expectationText(x)}</p>
      {issues.map((i) => (
        <p key={i.message} className="field-error">
          {i.message}
        </p>
      ))}
    </section>
  );
}

export function Sheet({ e }: { readonly e: ScenarioEditor }) {
  const total = scenario.sheetTotal(e.doc);
  const kinds = Object.keys(scenario.EXPECTATION_LABELS) as ExpectationKind[];
  return (
    <div className="workspace scroll">
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="section-head">
          <div>
            <h2>채점표</h2>
            <p className="small muted">
              모두 더해 {total.points}점.{" "}
              {total.note ?? "에이전트가 무엇을 하면 점수를 얻고 잃는지 정한다."}
            </p>
          </div>
          <MenuButton
            label="항목 더하기"
            icon="plus"
            items={kinds.map((k) => ({
              label: scenario.EXPECTATION_LABELS[k],
              onSelect: () => e.change((d) => scenario.addExpectation(d, k).doc),
            }))}
          />
        </div>
        <div className="stack" style={{ gap: 14 }}>
          {e.doc.expectations.length === 0 && (
            <p className="muted">아직 채점 항목이 없다. 오른쪽 위에서 더한다.</p>
          )}
          {e.doc.expectations.map((x) => (
            <Card key={x.id} x={x} e={e} />
          ))}
        </div>
      </div>
    </div>
  );
}
