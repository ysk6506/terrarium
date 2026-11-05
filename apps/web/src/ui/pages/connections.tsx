/**
 * Connections (REQ-051, REQ-052, REQ-053): the harnesses and agents Terrarium can run experiments on, who
 * connected them, whether they answer, how long until an unused one is removed, and the agents each one has.
 */
import type { ConnectionView, ConnectorSpec } from "@terrarium/core/contract";
import { useState } from "react";
import { expiryOf, reasonPhrase, TRANSPORT_LABELS, tracesLabel } from "../../logic";
import { Go, useAction, useApp, useAsync } from "../context";
import { Button, Dialog, Empty, Failure, Loading, Note, PageHead, ToneDot } from "../kit";
import { AgentCensusLine } from "./agent-census";
import { ConnectionDialog } from "./connection-dialog";
import { TryPanel } from "./connection-try";

type Editing = { readonly view?: ConnectionView } | undefined;

function AgentRows({
  view,
  agents,
}: {
  readonly view: ConnectionView;
  readonly agents: ConnectionView["agents"];
}) {
  if (agents.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>에이전트</th>
            <th>모델</th>
            <th>설명</th>
            <th>버전</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id}>
              <td>
                {a.name}
                {a.hidden && (
                  <span className="tag" style={{ marginLeft: 8 }}>
                    {reasonPhrase(a.hidden)}
                  </span>
                )}
              </td>
              <td>{a.model ?? "—"}</td>
              <td className="muted">{a.description ?? ""}</td>
              <td>
                <Go
                  to={{ name: "agentVersions", connectionId: view.id, agentId: a.id }}
                  aria-label={`${a.name}의 버전 기록`}
                >
                  버전 기록
                </Go>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badges({ view }: { readonly view: ConnectionView }) {
  const expiry = expiryOf(view);
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
      <ToneDot tone={view.status === "ok" ? "good" : "bad"}>
        {view.status === "ok" ? "연결됨" : "연결 안 됨"}
      </ToneDot>
      <span className="tag">
        {view.source === "config" ? "서버 설정" : `만든 사람 ${view.owner}`}
      </span>
      <span className="tag">{view.scope === "harness" ? "하네스" : "에이전트 하나"}</span>
      <span className="tag">{TRANSPORT_LABELS[view.toolTransport]}</span>
      <span className="tag">{tracesLabel(view.traces)}</span>
      {expiry.state !== "none" && (
        <ToneDot tone={expiry.state === "soon" ? "warn" : "neutral"}>{expiry.label}</ToneDot>
      )}
    </div>
  );
}

function Pairs({ view }: { readonly view: ConnectionView }) {
  const meta = Object.entries(view.metadata);
  if (meta.length === 0 && view.headers.length === 0) return null;
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
      {meta.map(([k, v]) => (
        <span className="tag" key={`m:${k}`} title="실험에 붙는 메타데이터">
          {k}={v}
        </span>
      ))}
      {view.headers.map((h) => (
        <span className="tag" key={`h:${h.name}`} title="모든 요청에 붙는 헤더">
          헤더 {h.name}
          {h.secret ? " (비밀)" : ""}
        </span>
      ))}
    </div>
  );
}

function Actions({
  view,
  mine,
  onEdit,
  onDelete,
  onChanged,
}: {
  readonly view: ConnectionView;
  readonly mine: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onChanged: () => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const act = async (call: "keepConnection" | "recheckConnection", done: string) => {
    if (await run(() => api.call(call, { params: { id: view.id } }), done)) onChanged();
  };
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <Button size="small" busy={busy} onClick={() => act("recheckConnection", "다시 확인했어요")}>
        다시 확인
      </Button>
      {view.source === "screen" && (
        <Button
          size="small"
          busy={busy}
          onClick={() => act("keepConnection", "계속 쓰기로 했어요")}
        >
          계속 쓰기
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
  );
}

/**
 * A harness that reads its tools from its own config file (Hermes) needs one fixed address; show it with
 * where to write it, and copy it in one press.
 */
function SlotAddress({ url }: { readonly url: string }) {
  const { toast } = useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast("툴 주소를 복사했어요");
    } catch {
      toast("복사하지 못했어요. 브라우저가 클립보드를 막고 있어요", "bad");
    }
  };
  return (
    <Note>
      <div className="stack" style={{ gap: 8 }}>
        <span>
          이 하네스는 툴 주소를 설정 파일에서만 읽어요. 아래 주소를 하네스 설정의 MCP 서버(Hermes는
          config.yaml의 mcp_servers → terrarium → url)에 한 번 적어 두세요. 실험이 돌 때만 그 세계로
          이어져요.
        </span>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <code style={{ wordBreak: "break-all" }} title="고정 툴 주소">
            {url}
          </code>
          <Button size="small" onClick={copy}>
            주소 복사
          </Button>
        </div>
      </div>
    </Note>
  );
}

/** The agents of a connection, how many there are and why some are left out, and "모두 보기". */
function AgentsPart({
  view,
  spec,
  mine,
  onChanged,
}: {
  readonly view: ConnectionView;
  readonly spec: ConnectorSpec | undefined;
  readonly mine: boolean;
  readonly onChanged: () => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [peek, setPeek] = useState(false);
  // The owner can make the connection list everything for every experiment; others only look.
  const persist = mine && spec?.fields.some((f) => f.key === "showHidden") === true;
  const showing = view.census.includesHidden || peek;
  const toggle = async () => {
    if (!persist) return setPeek(!peek);
    const body = { config: { ...view.config, showHidden: !view.census.includesHidden } };
    if (await run(() => api.call("updateConnection", { params: { id: view.id }, body }))) {
      setPeek(false);
      onChanged();
    }
  };
  const agents = peek ? [...view.agents, ...view.hiddenAgents] : view.agents;
  return (
    <>
      {view.status === "ok" && (
        <AgentCensusLine census={view.census} showing={showing} onToggle={toggle} busy={busy} />
      )}
      <AgentRows view={view} agents={agents} />
      <TryPanel view={view} agents={agents} />
    </>
  );
}

function ConnectionCard({
  view,
  spec,
  onEdit,
  onDelete,
  onChanged,
}: {
  readonly view: ConnectionView;
  readonly spec: ConnectorSpec | undefined;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onChanged: () => void;
}) {
  const { me } = useApp();
  const mine = view.source === "screen" && view.owner === me;
  return (
    <section className="panel panel-pad" aria-label={view.name}>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{view.name}</h2>
          <Actions
            view={view}
            mine={mine}
            onEdit={onEdit}
            onDelete={onDelete}
            onChanged={onChanged}
          />
        </div>
        {view.description && (
          <p className="muted" style={{ margin: 0 }}>
            {view.description}
          </p>
        )}
        <Badges view={view} />
        <Pairs view={view} />
        {view.mcpSlotUrl && <SlotAddress url={view.mcpSlotUrl} />}
        {view.status === "unreachable" && (
          <Note tone="bad">
            {view.error ?? "연결하지 못했어요. '다시 확인'을 눌러 한 번 더 해 보세요."}
          </Note>
        )}
        <AgentsPart view={view} spec={spec} mine={mine} onChanged={onChanged} />
      </div>
    </section>
  );
}

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
          <Button onClick={onClose}>닫기</Button>
          <Button kind="danger" busy={busy} onClick={remove}>
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
  return (
    <div className="page">
      <PageHead
        title="연결"
        lede="실험을 돌릴 하네스와 에이전트를 연결해요. 연결해 두면 새 실험에서 골라 써요."
        actions={
          <Button
            kind="primary"
            disabled={addable.length === 0}
            why="서버에 연결 방식이 없어요"
            onClick={() => setEditing({})}
          >
            연결 더하기
          </Button>
        }
      />
      {list.error && <Failure error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data?.length === 0 && (
        <Empty
          title="아직 연결된 하네스가 없어요"
          action={
            <Button kind="primary" onClick={() => setEditing({})}>
              연결 더하기
            </Button>
          }
        >
          OpenCode, LangGraph, OpenClaw는 전용 연결이 있어요. GoClaw, Hermes, LangChain 같은 다른
          에이전트는 범용 HTTP, A2A, MCP, 명령 가운데 맞는 것으로 붙여요. 주소와 토큰을 적고
          연결하면 바로 확인해 줘요.
        </Empty>
      )}
      <div className="stack" style={{ gap: 16 }}>
        {list.data?.map((view) => (
          <ConnectionCard
            key={view.id}
            view={view}
            spec={(connectors.data ?? []).find((c) => c.kind === view.connector)}
            onEdit={() => setEditing({ view })}
            onDelete={() => setDeleting(view)}
            onChanged={changed}
          />
        ))}
      </div>
      {editing && (
        <ConnectionDialog
          connectors={addable}
          existing={editing.view}
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
