/** The selected block's form: its caption, each parameter as the right control, and its problems. */
import { blockSpec, type Condition, type ParamValue } from "@terrarium/core/scenario";
import { scenario } from "../../logic";
import { Button, Check, NumberField, SelectField, TextField } from "../kit";
import { ConditionEditor } from "./ConditionEditor";
import type { ScenarioEditor } from "./useScenario";

type Field = scenario.Field;

function NumbersControl({
  field,
  set,
}: {
  readonly field: Extract<Field, { control: "numbers" }>;
  readonly set: (v: ParamValue) => void;
}) {
  if (field.items.length === 0) return <p className="tiny muted">이 장애에는 정할 값이 없다.</p>;
  const values = Object.fromEntries(field.items.map((i) => [i.name, i.value]));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {field.items.map((item) => (
        <NumberField
          key={item.name}
          label={item.label}
          value={item.value}
          min={item.min}
          max={item.max}
          unit={item.unit}
          onChange={(n) =>
            n !== undefined &&
            set({ ...values, [item.name]: Math.min(item.max, Math.max(item.min, n)) })
          }
        />
      ))}
    </div>
  );
}

function Control({
  field,
  e,
  nodeId,
  error,
}: {
  readonly field: Field;
  readonly e: ScenarioEditor;
  readonly nodeId: string;
  readonly error?: string;
}) {
  const set = (v: ParamValue | undefined) =>
    e.change((d) => scenario.setParam(d, nodeId, field.name, v));
  const help = field.help;
  const common = {
    label: field.optional ? `${field.label} (선택)` : field.label,
    ...(help ? { help } : {}),
    ...(error ? { error } : {}),
  };
  switch (field.control) {
    case "number":
      return (
        <NumberField
          {...common}
          value={field.value}
          min={field.min}
          max={field.max}
          step={field.step}
          unit={field.unit}
          onChange={(n) => set(n === undefined ? undefined : scenario.readNumber(String(n), field))}
        />
      );
    case "choice":
      return (
        <SelectField
          {...common}
          value={field.value}
          options={field.choices}
          onChange={(v) => set(v || undefined)}
        />
      );
    case "text":
      return (
        <TextField
          {...common}
          value={field.value}
          multiline={field.multiline}
          maxLength={field.maxLength}
          onChange={(v) => set(v)}
        />
      );
    case "toggle":
      return <Check label={common.label} checked={field.value} onChange={(v) => set(v)} />;
    case "condition":
      return (
        <div className="field">
          <span className="field-label">{common.label}</span>
          <ConditionEditor
            value={field.value ?? scenario.newCondition("alarm", e.index)}
            onChange={(c: Condition) => set(c)}
            index={e.index}
          />
          {error && <span className="field-error">{error}</span>}
        </div>
      );
    case "numbers":
      return (
        <div className="field">
          <span className="field-label">{common.label}</span>
          <NumbersControl field={field} set={set} />
        </div>
      );
  }
}

export function NodeInspector({
  e,
  nodeId,
}: {
  readonly e: ScenarioEditor;
  readonly nodeId: string;
}) {
  const node = e.doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const spec = blockSpec(node.type);
  const mine = e.issues.filter((i) => i.nodeId === nodeId);
  const fields = scenario.fieldsOf(e.doc, nodeId, e.index);
  return (
    <>
      <div className="builder-block stack">
        <h2 style={{ fontSize: 18 }}>{node.label || spec?.label || node.type}</h2>
        <p className="small muted">{spec?.description}</p>
        <TextField
          label="캔버스에 보일 이름 (선택)"
          value={node.label ?? ""}
          maxLength={200}
          onChange={(v) => e.change((d) => scenario.setLabel(d, nodeId, v))}
        />
      </div>
      {fields.length > 0 && (
        <div className="builder-block stack">
          {fields.map((f) => {
            const error = mine.find((i) => i.param === f.name && i.severity === "error")?.message;
            return (
              <Control key={f.name} field={f} e={e} nodeId={nodeId} {...(error ? { error } : {})} />
            );
          })}
        </div>
      )}
      {mine.filter((i) => !i.param).length > 0 && (
        <div className="builder-block">
          <ul className="issues">
            {mine
              .filter((i) => !i.param)
              .map((i) => (
                <li
                  key={`${i.code}-${i.message}`}
                  className={`issue${i.severity === "error" ? " issue-error" : ""}`}
                >
                  <span className="issue-mark" />
                  <span>{i.message}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
      {node.type !== "start" && (
        <div className="builder-block">
          <Button
            kind="danger"
            size="small"
            icon="trash"
            onClick={() => {
              e.change((d) => scenario.removeNodes(d, [nodeId]));
              e.select(undefined);
            }}
          >
            블록 지우기
          </Button>
        </div>
      )}
    </>
  );
}
