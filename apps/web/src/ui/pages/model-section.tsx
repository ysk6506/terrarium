/**
 * 설정의 "모델" 구역 (REQ-099, ADR-0119): LLM API를 워크스페이스에 등록해 두는 곳. 카드마다 이름 · 종류 · 주소 · 기본 모델 ·
 * 마지막 확인 결과. 아직 아무 기능도 쓰지 않는다는 말을 카드 아래에 한 줄로 해요. 키는 서버에만 있고 화면에는 끝 네 글자뿐이에요.
 */
import type { LlmModelView } from "@terrarium/core/contract";
import type { LlmKind } from "@terrarium/core/llm";
import { useState } from "react";
import {
  cardFacts,
  checkedWhen,
  checkLine,
  deleteText,
  EMPTY_BODY,
  EMPTY_TITLE,
  LIMIT_LINE,
  modelKindName,
  modelSectionState,
} from "../../logic";
import { useAction, useApp, useAsync, useNow } from "../context";
import { Button, Dialog, Empty, Failure, Loading, Section, ToneDot } from "../kit";
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
          <Button onClick={onClose}>닫기</Button>
          <Button kind="danger" busy={busy} onClick={remove}>
            지우기
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{deleteText(view, others)}</p>
    </Dialog>
  );
}

function ModelCard(props: {
  readonly view: LlmModelView;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onChanged: () => void;
}) {
  const { view, onEdit, onDelete, onChanged } = props;
  const { api, me } = useApp();
  const { busy, run } = useAction();
  const now = useNow();
  const mine = view.owner === me;
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
            <h3 style={{ margin: 0 }}>
              {view.name} <span className="tag">{modelKindName(view.kind)}</span>
              {view.isDefault && (
                <>
                  {" "}
                  <span className="tag tag-recommend">기본</span>
                </>
              )}
            </h3>
            <div className="small muted">{cardFacts(view).join(" · ")}</div>
            {view.headers.length > 0 && (
              <div className="small muted">헤더 {view.headers.join(", ")}</div>
            )}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Button size="small" kind="primary" busy={busy} onClick={() => act("checkModel")}>
              {busy ? "확인하는 중" : "연결 확인"}
            </Button>
            {!view.isDefault && (
              <Button
                size="small"
                busy={busy}
                onClick={() => act("setDefaultModel", "기본 모델로 정했어요")}
              >
                기본으로
              </Button>
            )}
            {mine && (
              <>
                <Button size="small" onClick={onEdit}>
                  고치기
                </Button>
                <Button size="small" kind="danger" onClick={onDelete}>
                  지우기
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }} aria-live="polite">
          <ToneDot tone={last.tone}>{last.text}</ToneDot>
          {when && <span className="small muted">{when}</span>}
        </div>
      </div>
    </section>
  );
}

export function ModelSection() {
  const { api } = useApp();
  const list = useAsync((signal) => api.call("listModels", { signal }), []);
  const [editing, setEditing] = useState<Editing>();
  const [deleting, setDeleting] = useState<LlmModelView>();
  const state = modelSectionState(list.data);
  const models = list.data ?? [];
  return (
    <Section
      title="모델"
      aside={
        <Button size="small" kind="primary" onClick={() => setEditing({})}>
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
        {models.map((view) => (
          <ModelCard
            key={view.id}
            view={view}
            onEdit={() => setEditing({ view })}
            onDelete={() => setDeleting(view)}
            onChanged={list.reload}
          />
        ))}
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
          onSaved={list.reload}
        />
      )}
      {deleting && (
        <DeleteDialog
          view={deleting}
          others={models.length - 1}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDeleting(undefined);
            list.reload();
          }}
        />
      )}
    </Section>
  );
}
