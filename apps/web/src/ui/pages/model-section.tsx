/**
 * 설정의 "모델" 구역 (REQ-099, ADR-0119): LLM API를 워크스페이스에 등록해 두는 곳. 카드마다 이름 · 종류 · 주소 · 기본 모델 ·
 * 마지막 확인 결과. 아직 아무 기능도 쓰지 않는다는 말을 카드 아래에 한 줄로 해요. 키는 서버에만 있고 화면에는 끝 네 글자뿐이에요.
 */
import type { LlmModelView } from "@terrarium/core/contract";
import type { LlmKind } from "@terrarium/core/llm";
import { useCallback, useEffect, useState } from "react";
import {
  cardFacts,
  checkedWhen,
  checkLine,
  defaultNote,
  deleteText,
  EMPTY_BODY,
  EMPTY_TITLE,
  LIMIT_LINE,
  MODELS_CHANGED,
  MODELS_HASH,
  matchesFilter,
  modelKindName,
  modelSectionState,
  NO_DEFAULT_WHY,
  repeatedNames,
  type ScopeFilter,
} from "../../logic";
import { modelsState, pickByText, useMossScreen } from "../../moss";
import { useAction, useApp, useAsync, useNow } from "../context";
import { Button, Dialog, Empty, Failure, Loading, Note, Section, ToneDot } from "../kit";
import { FilterEmpty, ScopeButton, ScopeFilterBar, ScopeTag, useOwnerName } from "../scope";
import { ModelDialog } from "./model-dialog";

type Editing = { readonly view?: LlmModelView; readonly kind?: LlmKind } | undefined;

function DeleteDialog(props: {
  readonly view: LlmModelView;
  readonly others: number;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const { view, others, onClose, onDeleted } = props;
  const { api } = useApp();
  const { busy, run } = useAction();
  const remove = async () => {
    if (await run(() => api.call("deleteModel", { params: { id: view.id } }), "등록을 지웠어요"))
      onDeleted();
  };
  return (
    <Dialog
      title={`'${view.name}' 등록을 지울까요`}
      onClose={onClose}
      actions={
        <>
          <Button data-moss-skip="폼과 대화상자 안" onClick={onClose}>
            닫기
          </Button>
          <Button data-moss-skip="폼과 대화상자 안" kind="danger" busy={busy} onClick={remove}>
            지우기
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{deleteText(view, others)}</p>
    </Dialog>
  );
}

function CardTitle({ view, twin }: { readonly view: LlmModelView; readonly twin: boolean }) {
  const ownerOf = useOwnerName();
  return (
    <h3 style={{ margin: 0 }}>
      {view.name}
      {twin && <span className="small muted"> · {ownerOf(view.owner)}</span>}{" "}
      <span className="tag">{modelKindName(view.kind)}</span>
      <ScopeTag item={view.sharing} />
      {view.isDefault && (
        <>
          {" "}
          <span className="tag tag-recommend">기본</span>
        </>
      )}
    </h3>
  );
}

/** What the maker and administrators may do to a model: who sees it, change it, delete it. */
function ChangeButtons(props: {
  readonly view: LlmModelView;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onChanged: () => void;
}) {
  const { view, onEdit, onDelete, onChanged } = props;
  return (
    <>
      <ScopeButton
        kind="model"
        id={view.id}
        name={view.name}
        owner={view.owner}
        current={{
          scope: view.sharing.scope,
          ...(view.sharing.group ? { group: view.sharing.group } : {}),
        }}
        onChanged={onChanged}
      />
      <Button data-moss-skip="폼과 대화상자 안" size="small" onClick={onEdit}>
        고치기
      </Button>
      <Button data-moss-skip="폼과 대화상자 안" size="small" kind="danger" onClick={onDelete}>
        지우기
      </Button>
    </>
  );
}

function ModelCard(props: {
  readonly view: LlmModelView;
  /** The same name is two people's: the maker is named beside it. */
  readonly twin: boolean;
  /** No model is the default: each card that cannot be one says what to change. */
  readonly noDefault: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onChanged: () => void;
}) {
  const { view, twin, noDefault, onEdit, onDelete, onChanged } = props;
  const { api } = useApp();
  const { busy, run } = useAction();
  const now = useNow();
  // the maker and administrators change it (permissions.md section 4); the screen asks the server's own answer
  const mayChange = view.sharing.canChange;
  const asDefault = defaultNote(view);
  const last = checkLine(view.lastCheck);
  const when = checkedWhen(view.lastCheck, now);
  const act = async (call: "checkModel" | "setDefaultModel", done?: string) => {
    if (await run(() => api.call(call, { params: { id: view.id } }), done)) onChanged();
  };
  return (
    <section className="panel panel-pad conn-card" aria-label={view.name}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="conn-head">
          <div>
            <CardTitle view={view} twin={twin} />
            <div className="small muted">{cardFacts(view).join(" · ")}</div>
            {view.headers.length > 0 && (
              <div className="small muted">헤더 {view.headers.join(", ")}</div>
            )}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Button
              size="small"
              kind="primary"
              busy={busy}
              data-moss-action="check-model"
              onClick={() => act("checkModel")}
            >
              {busy ? "확인하는 중" : "연결 확인"}
            </Button>
            {!view.isDefault && asDefault.canSet && (
              <Button
                size="small"
                busy={busy}
                data-moss-action="set-default-model"
                onClick={() => act("setDefaultModel", "기본 모델로 정했어요")}
              >
                기본으로
              </Button>
            )}
            {mayChange && (
              <ChangeButtons
                view={view}
                onEdit={onEdit}
                onDelete={onDelete}
                onChanged={onChanged}
              />
            )}
          </div>
        </div>
        {noDefault && asDefault.why && <p className="small muted">{asDefault.why}</p>}
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }} aria-live="polite">
          <ToneDot tone={last.tone}>{last.text}</ToneDot>
          {when && <span className="small muted">{when}</span>}
        </div>
      </div>
    </section>
  );
}

/** 이끼의 모델 동작: 모델 카드의 버튼과 같은 호출 (REQ-103) */
function useModelsMoss(models: readonly LlmModelView[], reload: () => void, onAdd: () => void) {
  const { api } = useApp();
  const { run } = useAction();
  const pick = (text: unknown, fallback: LlmModelView | undefined) =>
    pickByText(String(text ?? ""), models, (m) => m.name) ?? fallback;
  useMossScreen("settings", {
    read: () => modelsState(models),
    run: {
      "models-add": onAdd,
      "check-model": async (a) => {
        const hit = pick(a.text, models.find((m) => m.isDefault) ?? models[0]);
        if (!hit) throw new Error("등록한 모델이 없어요");
        if (await run(() => api.call("checkModel", { params: { id: hit.id } }))) reload();
        return `${hit.name} 연결을 확인했어요`;
      },
      "set-default-model": async (a) => {
        const hit = pick(
          a.text,
          models.find((m) => !m.isDefault),
        );
        if (!hit) throw new Error("기본으로 정할 다른 모델이 없어요");
        const done = "기본 모델로 정했어요";
        if (await run(() => api.call("setDefaultModel", { params: { id: hit.id } }), done))
          reload();
        return `${hit.name}이(가) 기본 모델이에요`;
      },
    },
    summary: (id) => {
      const m =
        id === "check-model"
          ? (models.find((x) => x.isDefault) ?? models[0])
          : models.find((x) => !x.isDefault);
      return m ? `모델 ${m.name}` : undefined;
    },
  });
}

/** The note when no model is the default, the filter, and one card for each model. */
function ModelCards(props: {
  readonly models: readonly LlmModelView[];
  readonly onEdit: (view: LlmModelView) => void;
  readonly onDelete: (view: LlmModelView) => void;
  readonly onChanged: () => void;
}) {
  const { models } = props;
  const { me } = useApp();
  const [who, setWho] = useState<ScopeFilter>("all");
  const shown = models.filter((m) =>
    matchesFilter(who, { owner: m.owner, scope: m.sharing.scope }, me),
  );
  const noDefault = models.length > 0 && !models.some((m) => m.isDefault);
  const twins = repeatedNames(models);
  return (
    <>
      {noDefault && (
        <Note tone="warn">
          <b>모두의 기본 모델이 아직 없어요.</b> {NO_DEFAULT_WHY} 기본으로 정하려면 아래 모델의
          '누가 볼 수 있나요'를 '모두'로 바꾼 뒤 '기본으로'를 눌러요.
        </Note>
      )}
      {models.length > 1 && (
        <div className="scope-filter-row" style={{ marginBottom: 0 }}>
          <ScopeFilterBar value={who} onChange={setWho} />
        </div>
      )}
      {models.length > 0 && shown.length === 0 && (
        <FilterEmpty filter={who} onClear={() => setWho("all")} />
      )}
      {shown.map((view) => (
        <ModelCard
          key={view.id}
          view={view}
          twin={twins.has(view.name)}
          noDefault={noDefault}
          onEdit={() => props.onEdit(view)}
          onDelete={() => props.onDelete(view)}
          onChanged={props.onChanged}
        />
      ))}
    </>
  );
}

export function ModelSection() {
  const { api } = useApp();
  const list = useAsync((signal) => api.call("listModels", { signal }), []);
  const [editing, setEditing] = useState<Editing>();
  const [deleting, setDeleting] = useState<LlmModelView>();
  const state = modelSectionState(list.data);
  const models = list.data ?? [];
  // 주소가 /settings#models 로 열리면 이 구역으로 (이끼가 꺼져 있을 때의 알약)
  useEffect(() => {
    if (window.location.hash === MODELS_HASH)
      document.getElementById(MODELS_HASH.slice(1))?.scrollIntoView({ block: "start" });
  }, []);
  // 모델이 바뀌면 이끼도 다시 읽어요: 기본 모델이 있어야만 깨어나요 (ADR-0125)
  const reload = useCallback(() => {
    list.reload();
    window.dispatchEvent(new Event(MODELS_CHANGED));
  }, [list.reload]);
  useModelsMoss(models, reload, () => setEditing({}));
  return (
    <Section
      id={MODELS_HASH.slice(1)}
      title="모델"
      aside={
        <Button
          size="small"
          kind="primary"
          data-moss-action="models-add"
          onClick={() => setEditing({})}
        >
          모델 더하기
        </Button>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>
          LiteLLM · OpenAI 호환 · Claude 호환 API를 등록해요. 서버에 저장하고, 키는 서버에만 있어요.
        </p>
        {list.error && <Failure error={list.error} retry={list.reload} />}
        {state === "loading" && !list.error && <Loading lines={2} />}
        {state === "empty" && <Empty title={EMPTY_TITLE}>{EMPTY_BODY}</Empty>}
        <ModelCards
          models={models}
          onEdit={(view) => setEditing({ view })}
          onDelete={setDeleting}
          onChanged={reload}
        />
        {state === "list" && (
          <p className="small muted" style={{ margin: 0 }}>
            {LIMIT_LINE}
          </p>
        )}
      </div>
      {editing && (
        <ModelDialog
          {...(editing.view ? { existing: editing.view } : {})}
          onClose={() => setEditing(undefined)}
          onSaved={reload}
        />
      )}
      {deleting && (
        <DeleteDialog
          view={deleting}
          others={models.length - 1}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDeleting(undefined);
            reload();
          }}
        />
      )}
    </Section>
  );
}
