/**
 * 모델 더하기 / 고치기 (REQ-099, ADR-0119). 새로 등록하면 세 걸음이에요: 어떤 API인지 → 이름·주소·키 → 확인 결과.
 * 고칠 때는 둘째 걸음부터예요. 키 칸을 비워 두면 지금 키를 그대로 써요.
 */
import type { LlmModelView } from "@terrarium/core/contract";
import type { LlmKind } from "@terrarium/core/llm";
import { useState } from "react";
import {
  blankModelForm,
  checkLine,
  createModelBody,
  formOfModel,
  MODEL_KIND_CARDS,
  type ModelForm,
  type ModelHeaderRow,
  modelFirstStep,
  modelKindName,
  modelProblems,
  updateModelBody,
} from "../../logic";
import { useAction, useApp } from "../context";
import { Button, Dialog, Note, SelectField, TextField } from "../kit";

type Step = "kind" | "form" | "result";

function KindStep({ onPick }: { readonly onPick: (kind: LlmKind) => void }) {
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>어떤 API인가요?</h3>
      <fieldset className="kind-cards">
        <legend className="sr-only">모델 API 종류</legend>
        {MODEL_KIND_CARDS.map((c) => (
          <button key={c.kind} type="button" className="kind-card" onClick={() => onPick(c.kind)}>
            <b>{c.name}</b>
            <span>{c.asks}</span>
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function HeaderRows(props: {
  readonly rows: readonly ModelHeaderRow[];
  readonly problems: Readonly<Record<string, string>>;
  readonly onChange: (rows: ModelHeaderRow[]) => void;
}) {
  const { rows, problems, onChange } = props;
  const set = (i: number, row: ModelHeaderRow) => onChange(rows.map((r, k) => (k === i ? row : r)));
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        사내 게이트웨이가 Authorization 말고 다른 헤더를 요구할 때 써요. 값은 서버에만 저장돼요.
      </p>
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
        <div className="stack" key={i} style={{ gap: 4 }}>
          <div className="pair-row pair-row-header">
            <input
              className="input"
              aria-label={`헤더 ${i + 1} 이름`}
              placeholder="X-Gateway-Token"
              value={row.name}
              onChange={(e) => set(i, { ...row, name: e.target.value })}
            />
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              aria-label={`헤더 ${i + 1} 값`}
              placeholder={row.kept ? "설정됨 (비워 두면 그대로)" : "값"}
              value={row.value}
              onChange={(e) => set(i, { ...row, value: e.target.value })}
            />
            <Button
              size="small"
              kind="quiet"
              aria-label={`헤더 ${i + 1} 지우기`}
              onClick={() => onChange(rows.filter((_, k) => k !== i))}
            >
              지우기
            </Button>
          </div>
          {problems[`headers.${i}`] && (
            <span className="field-error" role="alert">
              {problems[`headers.${i}`]}
            </span>
          )}
        </div>
      ))}
      <div>
        <Button
          size="small"
          onClick={() => onChange([...rows, { name: "", value: "", kept: false }])}
        >
          헤더 더하기
        </Button>
      </div>
    </div>
  );
}

function FormStep(props: {
  readonly form: ModelForm;
  readonly existing: LlmModelView | undefined;
  readonly problems: Readonly<Record<string, string>>;
  readonly patch: (change: Partial<ModelForm>) => void;
}) {
  const { form, existing, problems, patch } = props;
  const card = MODEL_KIND_CARDS.find((c) => c.kind === form.kind);
  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        <b>{modelKindName(form.kind)}</b> <span className="muted">{card?.asks}</span>
      </p>
      <TextField
        label="이름"
        value={form.name}
        onChange={(name) => patch({ name })}
        placeholder="예: 사내 LiteLLM"
        maxLength={60}
        error={problems.name}
        autoFocus
      />
      <TextField
        label="주소"
        value={form.baseUrl}
        onChange={(baseUrl) => patch({ baseUrl })}
        placeholder={card?.placeholder}
        help="주소 끝의 /v1 은 있어도 없어도 돼요."
        error={problems.baseUrl}
      />
      <TextField
        label="키"
        value={form.apiKey}
        onChange={(apiKey) => patch({ apiKey, clearKey: false })}
        secret
        placeholder={
          existing?.hasKey ? `설정됨 ${existing.keyHint ?? ""}` : "키가 필요 없으면 비워 둬요"
        }
        help={
          existing?.hasKey
            ? "비워 두면 지금 키를 그대로 써요. 키는 서버에만 저장돼요."
            : "서버에만 저장되고, 화면에는 끝 네 글자만 보여요."
        }
      />
      {existing?.hasKey && (
        <label className="check">
          <input
            type="checkbox"
            checked={form.clearKey}
            onChange={(e) => patch({ clearKey: e.target.checked, apiKey: "" })}
          />
          <span>저장한 키를 지워요</span>
        </label>
      )}
      <details
        className="fold"
        open={form.defaultModel !== "" || form.headers.length > 0 || undefined}
      >
        <summary>더 정하기 (선택)</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <TextField
            label="기본 모델 이름"
            value={form.defaultModel}
            onChange={(defaultModel) => patch({ defaultModel })}
            placeholder="예: gpt-4o"
            help="모르면 비워 둬요. 연결을 확인한 뒤 목록에서 고를 수 있어요."
          />
          <HeaderRows
            rows={form.headers}
            problems={problems}
            onChange={(headers) => patch({ headers })}
          />
        </div>
      </details>
    </div>
  );
}

/** After saving: what the check found, and a list to pick the model's name from when it gave one. */
function ResultStep(props: {
  readonly view: LlmModelView;
  readonly onPick: (name: string) => Promise<void>;
  readonly busy: boolean;
}) {
  const { view, onPick, busy } = props;
  const last = checkLine(view.lastCheck);
  const names = view.lastCheck?.models ?? [];
  const [chosen, setChosen] = useState(view.defaultModel ?? names[0] ?? "");
  return (
    <div className="stack">
      <Note tone={last.tone === "bad" ? "bad" : "good"}>
        {last.tone === "bad" ? "등록했지만 연결은 안 됐어요. " : "등록했어요. "}
        {last.text}
      </Note>
      {last.tone === "bad" && (
        <p className="small muted" style={{ margin: 0 }}>
          카드에서 '고치기'로 주소나 키를 바꾸고 '연결 확인'을 다시 눌러 보세요.
        </p>
      )}
      {names.length > 0 && (
        <>
          <SelectField
            label="기본 모델 이름"
            value={chosen}
            options={names.map((n) => ({ value: n, label: n }))}
            onChange={setChosen}
            help={
              view.lastCheck?.modelCount && view.lastCheck.modelCount > names.length
                ? `처음 ${names.length}개만 보여요.`
                : undefined
            }
          />
          <div>
            <Button busy={busy} disabled={chosen === ""} onClick={() => onPick(chosen)}>
              이 모델로 정하기
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The dialog's state and what its buttons do. */
function useModelDialog(props: {
  readonly existing: LlmModelView | undefined;
  readonly initialKind: LlmKind | undefined;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { existing, initialKind, onClose, onSaved } = props;
  const { api } = useApp();
  const { busy, run } = useAction();
  const [step, setStep] = useState<Step>(modelFirstStep(existing, initialKind ?? ""));
  const [form, setForm] = useState<ModelForm>(() =>
    existing ? formOfModel(existing) : blankModelForm(initialKind ?? ""),
  );
  const [shown, setShown] = useState(false);
  const [made, setMade] = useState<LlmModelView>();
  const patch = (change: Partial<ModelForm>) => setForm((f) => ({ ...f, ...change }));

  const change = async (existingView: LlmModelView) => {
    const saved = await run(
      () =>
        api.call("updateModel", { params: { id: existingView.id }, body: updateModelBody(form) }),
      "고쳤어요",
    );
    if (saved) {
      onSaved();
      onClose();
    }
  };
  const save = async () => {
    setShown(true);
    if (Object.keys(modelProblems(form)).length > 0) return;
    if (existing) return change(existing);
    // registering is one step and checking is the next: the person sees at once whether it answers
    const created = await run(() => api.call("createModel", { body: createModelBody(form) }));
    if (!created) return;
    onSaved();
    const checked = await run(() => api.call("checkModel", { params: { id: created.id } }));
    setMade(checked ?? created);
    setStep("result");
    onSaved();
  };
  const pick = async (name: string) => {
    if (!made) return;
    const saved = await run(
      () => api.call("updateModel", { params: { id: made.id }, body: { defaultModel: name } }),
      "기본 모델 이름을 정했어요",
    );
    if (saved) {
      onSaved();
      onClose();
    }
  };
  const kind = (next: LlmKind) => {
    patch({ kind: next });
    setStep("form");
  };
  return {
    busy,
    step,
    form,
    made,
    patch,
    save,
    pick,
    kind,
    problems: shown ? modelProblems(form) : {},
  };
}

export function ModelDialog(props: {
  readonly existing?: LlmModelView;
  readonly initialKind?: LlmKind;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const { existing, onClose } = props;
  const d = useModelDialog({
    existing,
    initialKind: props.initialKind,
    onClose,
    onSaved: props.onSaved,
  });
  return (
    <Dialog
      wide
      title={existing ? `모델 고치기 — ${existing.name}` : "모델 더하기"}
      onClose={onClose}
      actions={
        d.step === "result" ? (
          <Button kind="primary" onClick={onClose}>
            닫기
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>닫기</Button>
            {d.step === "form" && (
              <Button kind="primary" busy={d.busy} onClick={d.save}>
                {existing ? "고친 내용 저장" : "등록하고 연결 확인"}
              </Button>
            )}
          </>
        )
      }
    >
      {d.step === "kind" && <KindStep onPick={d.kind} />}
      {d.step === "form" && (
        <FormStep form={d.form} existing={existing} problems={d.problems} patch={d.patch} />
      )}
      {d.step === "result" && d.made && <ResultStep view={d.made} onPick={d.pick} busy={d.busy} />}
    </Dialog>
  );
}
