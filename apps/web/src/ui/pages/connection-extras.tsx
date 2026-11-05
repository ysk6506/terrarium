/**
 * Two parts of the connection form that are not the connector's own list of fields (REQ-079, ADR-0085): the
 * presets that stand for a whole template, and the choice of where the harness's traces pile up.
 */
import type {
  ConnectorField,
  ConnectorPreset,
  ConnectorSpec,
  TelemetryAdapterList,
} from "@terrarium/core/contract";
import {
  adapterSpecOf,
  advancedFields,
  type ConnectionForm,
  CUSTOM_PRESET,
  TRACES_QUESTION,
  type TracesForm,
  tracesKind,
  tracesOptions,
} from "../../logic";
import { Note, Segmented } from "../kit";
import { ConnectorFieldInput } from "./connection-form";

type Patch = (change: Partial<ConnectionForm>) => void;

/** The fields of a form shown in a row, with the rarely used ones folded under a summary. */
export function FoldedFields({
  fields,
  summary,
  form,
  problems,
  kept,
  patch,
  keyPrefix = "",
}: {
  readonly fields: readonly ConnectorField[];
  readonly summary: string;
  readonly form: ConnectionForm;
  readonly problems: Readonly<Record<string, string>>;
  readonly kept: readonly string[];
  readonly patch: Patch;
  readonly keyPrefix?: string;
}) {
  if (fields.length === 0) return null;
  const changed = fields.some((f) => (form.values[f.key] ?? "") !== String(f.default ?? ""));
  return (
    <details className="fold" open={changed || undefined}>
      <summary>{summary}</summary>
      <div className="stack" style={{ marginTop: 12 }}>
        {fields.map((f) => (
          <ConnectorFieldInput
            key={f.key}
            field={f}
            form={form}
            kept={kept.includes(f.key)}
            error={problems[`${keyPrefix}${f.key}`]}
            patch={patch}
          />
        ))}
      </div>
    </details>
  );
}

function PresetPromise({ preset }: { readonly preset: ConnectorPreset }) {
  return (
    <Note>
      <div className="stack" style={{ gap: 6 }}>
        <strong>이 API가 이렇게 말해야 해요</strong>
        <span className="small">
          보내는 것: <code>{preset.promise.request}</code>
        </span>
        <span className="small">
          받는 것: <code>{preset.promise.reply}</code>
        </span>
      </div>
    </Note>
  );
}

/** "OpenAI 호환 채팅 · 간단 JSON · 직접 적기": the few questions of a preset, and the rest of the template as "고급". */
export function PresetForm({
  spec,
  form,
  problems,
  kept,
  patch,
}: {
  readonly spec: ConnectorSpec;
  readonly form: ConnectionForm;
  readonly problems: Readonly<Record<string, string>>;
  readonly kept: readonly string[];
  readonly patch: Patch;
}) {
  const presets = spec.presets ?? [];
  const chosen = presets.find((p) => p.key === form.preset);
  return (
    <div className="stack">
      <Segmented
        label="연결하는 방법"
        value={chosen?.key ?? CUSTOM_PRESET}
        options={[
          ...presets.map((p) => ({ value: p.key, label: p.label })),
          { value: CUSTOM_PRESET, label: "직접 적기" },
        ]}
        onChange={(preset) => patch({ preset })}
      />
      {chosen && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {chosen.description}
          </p>
          {chosen.fields.map((f) => (
            <ConnectorFieldInput
              key={f.key}
              field={f}
              form={form}
              kept={kept.includes(f.key)}
              error={problems[f.key]}
              patch={patch}
            />
          ))}
          <PresetPromise preset={chosen} />
          <FoldedFields
            fields={advancedFields(spec, chosen)}
            summary={`고급 설정 ${advancedFields(spec, chosen).length}개`}
            form={form}
            problems={problems}
            kept={kept}
            patch={patch}
          />
        </>
      )}
    </div>
  );
}

/** "이 하네스의 트레이스는 어디에 쌓이나요?": none, ClickStack, Langfuse, and the server's own default. */
export function TracesChooser({
  list,
  traces,
  problems,
  kept,
  onChange,
}: {
  readonly list: TelemetryAdapterList | undefined;
  readonly traces: TracesForm;
  readonly problems: Readonly<Record<string, string>>;
  readonly kept: readonly string[];
  readonly onChange: (next: TracesForm) => void;
}) {
  if (!list) return null;
  const spec = adapterSpecOf(list, traces.kind);
  // The tool's form is drawn by the same input as a connector's field, on a form of its own.
  const own: ConnectionForm = {
    name: "",
    description: "",
    values: traces.values,
    cleared: traces.cleared,
    headers: [],
    metadata: [],
  };
  const patch: Patch = (change) =>
    onChange({
      ...traces,
      ...(change.values ? { values: change.values } : {}),
      ...(change.cleared ? { cleared: change.cleared } : {}),
    });
  const main = spec?.fields.filter((f) => !f.advanced) ?? [];
  const rest = spec?.fields.filter((f) => f.advanced) ?? [];
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field-label">{TRACES_QUESTION}</legend>
      <Segmented
        label={TRACES_QUESTION}
        value={traces.kind}
        options={tracesOptions(list)}
        onChange={(kind) => onChange(tracesKind(list, kind))}
      />
      {traces.kind === "none" && (
        <p className="small muted" style={{ margin: 0 }}>
          트레이스를 읽지 않아요. 실행 결과에는 테라리움이 본 것만 들어가요.
        </p>
      )}
      {traces.kind === "default" && list.serverDefault && (
        <p className="small muted" style={{ margin: 0 }}>
          서버 설정에 정해 둔 {list.serverDefault.name}에서 읽어요.
        </p>
      )}
      {spec && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {spec.description}
          </p>
          {main.map((f) => (
            <ConnectorFieldInput
              key={f.key}
              field={f}
              form={own}
              kept={kept.includes(f.key)}
              error={problems[`traces.${f.key}`]}
              patch={patch}
            />
          ))}
          <FoldedFields
            fields={rest}
            summary={`드물게 쓰는 설정 ${rest.length}개`}
            form={own}
            problems={problems}
            kept={kept}
            patch={patch}
            keyPrefix="traces."
          />
          <p className="small muted" style={{ margin: 0 }}>
            찾는 방법: {spec.key}
          </p>
        </>
      )}
    </fieldset>
  );
}
