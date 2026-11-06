/**
 * Connecting something, or changing a connection (REQ-051, REQ-052): pick the protocol, fill what it asks for,
 * try it, save it. The fields come from the connector's own description, so a new protocol needs no new screen.
 */
import type {
  ConnectionCheck,
  ConnectionView,
  ConnectorField,
  ConnectorSpec,
  TelemetryAdapterList,
} from "@terrarium/core/contract";
import { useState } from "react";
import {
  blankForm,
  blankTraces,
  type ConnectionForm,
  configOf,
  formOf,
  formProblems,
  headersOf,
  hiddenWarning,
  metadataOf,
  reasonPhrase,
  settingsOf,
  TRANSPORT_LABELS,
  tracesProblems,
  tracesRequest,
} from "../../logic";
import { useAction, useApp, useAsync } from "../context";
import { Button, Dialog, Note, TextField } from "../kit";
import { AgentCensusLine } from "./agent-census";
import { PresetForm, TracesChooser } from "./connection-extras";
import { ConnectorFieldInput, HeaderEditor, MetaEditor } from "./connection-form";
import { KindCards } from "./connection-kinds";

const emptyForm: ConnectionForm = {
  name: "",
  description: "",
  values: {},
  cleared: [],
  headers: [],
  metadata: [],
};

export interface ConnectionDialogProps {
  readonly connectors: readonly ConnectorSpec[];
  /** The connection being changed; left out for a new one. */
  readonly existing?: ConnectionView;
  /** The kind of harness already chosen on the card that opened this, so the form starts on its fields. */
  readonly initialKind?: string;
  readonly onClose: () => void;
  readonly onSaved: (view: ConnectionView) => void;
}

/** How this kind of harness gets the tools, folded: the form is what the person came for. */
function ToolGuide({ spec }: { readonly spec: ConnectorSpec }) {
  return (
    <details className="fold">
      <summary>툴은 어떻게 받나요? — {TRANSPORT_LABELS[spec.toolTransport]}</summary>
      <ol className="list-plain" style={{ marginTop: 8 }}>
        {spec.toolGuide.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </details>
  );
}

/** Every agent found, with the left-out ones marked with why, for the person who pressed "모두 보기". */
function AllAgents({ check }: { readonly check: ConnectionCheck }) {
  const all = [...check.agents, ...check.hiddenAgents];
  const warned = all.find((a) => a.hidden);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <ul className="list-plain small">
        {all.slice(0, 200).map((a) => (
          <li key={a.id}>
            {a.name}
            {a.hidden ? ` — ${reasonPhrase(a.hidden)}` : ""}
          </li>
        ))}
      </ul>
      {warned && <span className="small">{hiddenWarning(warned)}</span>}
    </div>
  );
}

function CheckResult({ check }: { readonly check: ConnectionCheck }) {
  const [all, setAll] = useState(false);
  if (!check.ok) return <Note tone="bad">{check.error ?? "연결하지 못했어요"}</Note>;
  const listed = check.agents.filter((a) => !a.hidden).map((a) => a.name);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Note tone="good">
        <div className="stack" style={{ gap: 4 }}>
          <span>연결됐어요({check.ms} ms).</span>
          {check.census.total > 0 && !all && <span>{listed.slice(0, 8).join(", ")}</span>}
          {check.notes.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </Note>
      <AgentCensusLine
        census={check.census}
        showing={all || check.census.includesHidden}
        onToggle={() => setAll(!all)}
      />
      {all && <AllAgents check={check} />}
    </div>
  );
}

function Fields({
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
  readonly patch: (change: Partial<ConnectionForm>) => void;
}) {
  const draw = (f: ConnectorField) => (
    <ConnectorFieldInput
      key={f.key}
      field={f}
      form={form}
      kept={kept.includes(f.key)}
      error={problems[f.key]}
      patch={patch}
    />
  );
  const advanced = spec.fields.filter((f) => f.advanced);
  return (
    <>
      {spec.fields.filter((f) => !f.advanced).map(draw)}
      {advanced.length > 0 && (
        <details
          className="fold"
          open={
            advanced.some((f) => (form.values[f.key] ?? "") !== String(f.default ?? "")) ||
            undefined
          }
        >
          <summary>드물게 쓰는 설정 {advanced.length}개</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {advanced.map(draw)}
          </div>
        </details>
      )}
    </>
  );
}

function Extras({
  form,
  problems,
  patch,
}: {
  readonly form: ConnectionForm;
  readonly problems: Readonly<Record<string, string>>;
  readonly patch: (change: Partial<ConnectionForm>) => void;
}) {
  return (
    <>
      <details className="fold" open={form.headers.length > 0 || undefined}>
        <summary>
          헤더 {form.headers.length > 0 ? `${form.headers.length}개` : "(필요할 때만)"}
        </summary>
        <div style={{ marginTop: 12 }}>
          <HeaderEditor
            rows={form.headers}
            problems={problems}
            onChange={(headers) => patch({ headers })}
          />
        </div>
      </details>
      <details className="fold" open={form.metadata.length > 0 || undefined}>
        <summary>
          실험 메타데이터 {form.metadata.length > 0 ? `${form.metadata.length}개` : "(선택)"}
        </summary>
        <div style={{ marginTop: 12 }}>
          <MetaEditor
            rows={form.metadata}
            problems={problems}
            onChange={(metadata) => patch({ metadata })}
          />
        </div>
      </details>
    </>
  );
}

/** Everything wrong with the form before anything is sent, the connector's and the traces'. */
function problemsOf(
  spec: ConnectorSpec,
  form: ConnectionForm,
  kept: readonly string[],
  list: TelemetryAdapterList | undefined,
  existing: ConnectionView | undefined,
): Record<string, string> {
  return {
    ...formProblems(spec, form, kept),
    ...tracesProblems(list, form.traces ?? blankTraces(list), existing?.traces.secrets ?? []),
  };
}

/** What the form starts as: the connection being changed, the chosen kind's blanks, or nothing yet. */
function startForm(
  connectors: readonly ConnectorSpec[],
  existing: ConnectionView | undefined,
  initialKind: string | undefined,
): ConnectionForm {
  const own = connectors.find((c) => c.kind === existing?.connector);
  if (existing && own) return formOf(own, existing);
  const chosen = connectors.find((c) => c.kind === initialKind);
  return chosen ? blankForm(chosen) : emptyForm;
}

function useConnectionDialog({
  connectors,
  existing,
  initialKind,
  onSaved,
}: ConnectionDialogProps) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [kind, setKind] = useState(existing?.connector ?? initialKind ?? "");
  const spec = connectors.find((c) => c.kind === kind);
  const [form, setForm] = useState<ConnectionForm>(() =>
    startForm(connectors, existing, initialKind),
  );
  const [check, setCheck] = useState<ConnectionCheck>();
  const [shown, setShown] = useState(false);
  const kept = existing?.secrets ?? [];
  const list = useAsync((signal) => api.call("listTelemetryAdapters", { signal }), []).data;
  const traces = form.traces ?? blankTraces(list);
  const problems = spec && shown ? problemsOf(spec, form, kept, list, existing) : {};
  const patch = (change: Partial<ConnectionForm>) => {
    setForm((f) => ({ ...f, ...change }));
    setCheck(undefined);
  };
  const pick = (next: string) => {
    const chosen = connectors.find((c) => c.kind === next);
    setKind(next);
    if (chosen)
      setForm((f) => ({
        ...blankForm(chosen),
        name: f.name,
        description: f.description,
        ...(f.traces ? { traces: f.traces } : {}),
      }));
    setCheck(undefined);
  };
  /** Show what is wrong, and say whether anything is. */
  const ready = (): ConnectorSpec | undefined => {
    setShown(true);
    return spec && Object.keys(problemsOf(spec, form, kept, list, existing)).length === 0
      ? spec
      : undefined;
  };
  /** Where the traces go, for the request; left out when the server's list of tools did not load. */
  const tracesBody = () =>
    list ? { traces: tracesRequest(list, traces, settingsOf) } : ({} as Record<string, never>);
  const test = async () => {
    const s = ready();
    if (!s) return;
    const body = {
      connector: s.kind,
      ...(existing ? { id: existing.id } : {}),
      config: configOf(s, form),
      headers: headersOf(form.headers),
      ...tracesBody(),
    };
    const result = await run(() => api.call("checkConnection", { body }));
    if (result) setCheck(result);
  };
  const save = async () => {
    const s = ready();
    if (!s) return;
    const common = {
      name: form.name.trim(),
      description: form.description.trim(),
      config: configOf(s, form),
      headers: headersOf(form.headers),
      metadata: metadataOf(form.metadata),
      ...tracesBody(),
    };
    const saved = await run(
      () =>
        existing
          ? api.call("updateConnection", { params: { id: existing.id }, body: common })
          : api.call("createConnection", { body: { connector: s.kind, ...common } }),
      existing ? "연결을 고쳤어요" : "연결을 저장했어요",
    );
    if (saved) onSaved(saved);
  };
  return { busy, kind, spec, form, check, problems, kept, patch, pick, test, save, list, traces };
}

type DialogState = ReturnType<typeof useConnectionDialog>;

/** The buttons under the dialog: close, check the connection, save. */
function DialogActions({ d, onClose }: { readonly d: DialogState; readonly onClose: () => void }) {
  return (
    <>
      <Button onClick={onClose}>닫기</Button>
      <Button onClick={d.test} busy={d.busy} disabled={!d.spec} why="연결 방식을 먼저 골라 주세요">
        연결 확인
      </Button>
      <Button
        kind="primary"
        onClick={d.save}
        busy={d.busy}
        disabled={!d.spec}
        why="연결 방식을 먼저 골라 주세요"
      >
        저장
      </Button>
    </>
  );
}

/** What is asked once a kind of connection is picked. */
function DialogFields({
  d,
  spec,
  existing,
}: {
  readonly d: DialogState;
  readonly spec: ConnectorSpec;
  readonly existing: ConnectionDialogProps["existing"];
}) {
  const { form, problems } = d;
  return (
    <>
      <ToolGuide spec={spec} />
      <TextField
        label="이름"
        value={form.name}
        onChange={(name) => d.patch({ name })}
        placeholder="예: 검색팀 OpenCode"
        error={problems.name}
      />
      <TextField
        label="설명 (선택)"
        value={form.description}
        onChange={(description) => d.patch({ description })}
        maxLength={300}
      />
      {spec.presets ? (
        <PresetForm spec={spec} form={form} problems={problems} kept={d.kept} patch={d.patch} />
      ) : null}
      {(!spec.presets || !form.preset) && (
        <Fields spec={spec} form={form} problems={problems} kept={d.kept} patch={d.patch} />
      )}
      <TracesChooser
        list={d.list}
        traces={d.traces}
        problems={problems}
        kept={existing?.traces.secrets ?? []}
        onChange={(traces) => d.patch({ traces })}
      />
      <Extras form={form} problems={problems} patch={d.patch} />
      {d.check && <CheckResult check={d.check} />}
      {!existing && (
        <p className="small muted" style={{ margin: 0 }}>
          화면에서 만든 연결은 한동안 실험에 쓰지 않으면 지워져요. 지워지기 전에 모든 화면 위에서
          알려 드려요.
        </p>
      )}
    </>
  );
}

/** The kind of harness: the cards, or just the one that was chosen on the page, with a way back to the cards. */
function KindStep({
  d,
  connectors,
  chosen,
}: {
  readonly d: DialogState;
  readonly connectors: readonly ConnectorSpec[];
  readonly chosen: string | undefined;
}) {
  const [choosing, setChoosing] = useState(!chosen);
  if (choosing || !d.spec)
    return (
      <>
        <h3 style={{ margin: 0 }}>어떤 하네스인가요?</h3>
        <KindCards
          connectors={connectors}
          picked={d.kind}
          onPick={(kind) => {
            d.pick(kind);
            setChoosing(false);
          }}
        />
      </>
    );
  return (
    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
      <p style={{ margin: 0 }}>
        <b>{d.spec.label}</b> <span className="muted">{d.spec.description}</span>
      </p>
      <Button size="small" kind="quiet" onClick={() => setChoosing(true)}>
        다른 하네스 고르기
      </Button>
    </div>
  );
}

/** Add a connection, or change one that exists (the kind of an existing one cannot change). */
export function ConnectionDialog(props: ConnectionDialogProps) {
  const { connectors, existing, onClose } = props;
  const d = useConnectionDialog(props);
  const { spec } = d;
  return (
    <Dialog
      wide
      title={existing ? `연결 고치기 — ${existing.name}` : "연결 더하기"}
      onClose={onClose}
      actions={<DialogActions d={d} onClose={onClose} />}
    >
      <div className="stack">
        {!existing && <KindStep d={d} connectors={connectors} chosen={props.initialKind} />}
        {spec && <DialogFields d={d} spec={spec} existing={existing} />}
      </div>
    </Dialog>
  );
}
