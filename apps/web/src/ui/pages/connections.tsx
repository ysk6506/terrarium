/**
 * Connections (REQ-051, REQ-052, REQ-053): the harnesses and agents Terrarium can run experiments on, who
 * connected them, whether they answer, how long until an unused one is removed, and the agents each one has.
 */
import type { ConnectionView } from "@terrarium/core/contract";
import { useState } from "react";
import { splitConnections } from "../../logic";
import { connectionsState, useMossScreen } from "../../moss";
import { Go, useAction, useApp, useAsync } from "../context";
import { Button, Dialog, Empty, Failure, Loading, PageHead } from "../kit";
import { ConnectionCard } from "./connection-card";
import { ConnectionDialog } from "./connection-dialog";
import { KindCards } from "./connection-kinds";

type Editing = { readonly view?: ConnectionView; readonly kind?: string } | undefined;

function DeleteDialog({
  view,
  onClose,
  onDeleted,
}: {
  readonly view: ConnectionView;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const remove = async () => {
    if (
      await run(() => api.call("deleteConnection", { params: { id: view.id } }), "연결을 지웠어요")
    )
      onDeleted();
  };
  return (
    <Dialog
      title={`'${view.name}' 연결을 지울까`}
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
      <p style={{ margin: 0 }}>
        저장된 토큰과 이 연결의 에이전트 버전 기록도 함께 지워요. 이 연결로 이미 돌린 실험의 결과는
        그대로 남아요. 돌고 있는 실행이 있으면 지워지지 않아요.
      </p>
    </Dialog>
  );
}

/** The buttons at the top: the guide for connecting an agent that stays on for hours, and a new connection. */
function HeadActions({ canAdd, onAdd }: { readonly canAdd: boolean; readonly onAdd: () => void }) {
  return (
    <>
      <Go data-moss-action="go-operation-guide" to={{ name: "operationGuide" }} className="btn">
        운영 모드로 연결
      </Go>
      <Button
        kind="primary"
        data-moss-action="connections-add"
        disabled={!canAdd}
        why="서버에 연결 방식이 없어요"
        onClick={onAdd}
      >
        연결 더하기
      </Button>
    </>
  );
}

/** The built-in reference agents, folded away: they play a script, so there is nothing to talk to. */
function ReferenceFold(props: {
  readonly views: readonly ConnectionView[];
  readonly onChanged: () => void;
}) {
  const { views, onChanged } = props;
  const agents = views.reduce((n, v) => n + v.agents.length, 0);
  if (views.length === 0) return null;
  return (
    <details className="fold detail-fold">
      <summary>
        내장 기준 에이전트 {agents} — 아무것도 안 함 · 찍기 · 정답만 앎 (변별력 점검에 쓰여요)
      </summary>
      <div className="stack" style={{ gap: 12, marginTop: 12 }}>
        {views.map((view) => (
          <ConnectionCard
            key={view.id}
            view={view}
            spec={undefined}
            reference
            onEdit={() => undefined}
            onDelete={() => undefined}
            onChanged={onChanged}
          />
        ))}
      </div>
    </details>
  );
}

/** 이끼의 "연결 더하기": 버튼과 같은 `onAdd` (REQ-103) */
function useConnectionsMoss(
  views: readonly ConnectionView[] | undefined,
  canAdd: boolean,
  onAdd: () => void,
) {
  useMossScreen("connections", {
    read: () => connectionsState(views ?? []),
    run: {
      "connections-add": () => {
        if (!canAdd) throw new Error("서버에 연결 방식이 없어요");
        onAdd();
      },
    },
  });
}

export function ConnectionsPage() {
  const { api, reloadMeta } = useApp();
  const list = useAsync((signal) => api.call("listConnections", { signal }), []);
  const connectors = useAsync((signal) => api.call("listConnectors", { signal }), []);
  const [editing, setEditing] = useState<Editing>();
  const [deleting, setDeleting] = useState<ConnectionView>();
  const changed = () => {
    list.reload();
    reloadMeta();
  };
  const addable = (connectors.data ?? []).filter((c) => c.fromScreen);
  const { mine, reference } = splitConnections(list.data ?? []);
  useConnectionsMoss(list.data, addable.length > 0, () => setEditing({}));
  return (
    <div className="page">
      <PageHead
        title="연결"
        lede="실험을 돌릴 하네스와 에이전트를 연결해요. 연결해 두면 새 실험에서 골라 써요."
        actions={<HeadActions canAdd={addable.length > 0} onAdd={() => setEditing({})} />}
      />
      {list.error && <Failure error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && (
        <section className="stack" style={{ gap: 12 }} aria-label="내 연결">
          <h2 style={{ margin: 0 }}>내 연결 {mine.length}</h2>
          {mine.length === 0 && (
            <Empty title="아직 연결된 하네스가 없어요">
              아래에서 쓰는 하네스를 고르면 주소와 토큰만 물어봐요. 연결하면 바로 확인해 줘요.
            </Empty>
          )}
          {mine.map((view) => (
            <ConnectionCard
              key={view.id}
              view={view}
              spec={(connectors.data ?? []).find((c) => c.kind === view.connector)}
              onEdit={() => setEditing({ view })}
              onDelete={() => setDeleting(view)}
              onChanged={changed}
            />
          ))}
        </section>
      )}
      {addable.length > 0 && (
        <section className="stack" style={{ gap: 12, marginTop: 28 }} aria-label="연결 더하기">
          <h2 style={{ margin: 0 }}>연결 더하기 — 어떤 하네스인가요?</h2>
          <KindCards connectors={addable} onPick={(kind) => setEditing({ kind })} />
        </section>
      )}
      <div style={{ marginTop: 28 }}>
        <ReferenceFold views={reference} onChanged={changed} />
      </div>
      {editing && (
        <ConnectionDialog
          connectors={addable}
          existing={editing.view}
          {...(editing.kind ? { initialKind: editing.kind } : {})}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            changed();
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          view={deleting}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDeleting(undefined);
            changed();
          }}
        />
      )}
    </div>
  );
}
