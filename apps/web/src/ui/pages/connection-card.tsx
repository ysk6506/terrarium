/**
 * One connection as a card (REQ-051, REQ-079, beta feedback 15 to 17). The top line is what a person asks first: the
 * name, how it stands, what kind it is and which tool address it uses, when it was last used, and "말 걸어 보기" as the
 * first button. The agents are one line with a search box, not a page; the upkeep (check again, keep, change, delete,
 * the slot address) is folded under "설정".
 */
import type { ConnectionView, ConnectorSpec } from "@terrarium/core/contract";
import type { AgentInfo } from "@terrarium/core/experiments";
import { useState } from "react";
import {
  ADDRESS_LABELS,
  AGENT_PREVIEW,
  addressKind,
  agentLine,
  censusText,
  expiryOf,
  KIND_CARDS,
  matchAgents,
  reasonPhrase,
  relativeTime,
  TRANSPORT_LABELS,
  tracesLabel,
} from "../../logic";
import { Go, useAction, useApp, useNow } from "../context";
import { Button, Note, ToneDot } from "../kit";
import { ScopeButton, ScopeTag, useOwnerName } from "../scope";
import { TryPanel, whyNot } from "./connection-try";

function AgentList({
  view,
  agents,
  all,
}: {
  readonly view: ConnectionView;
  readonly agents: readonly AgentInfo[];
  readonly all: boolean;
}) {
  const shown = all ? agents : agents.slice(0, AGENT_PREVIEW);
  if (agents.length === 0) return <p className="small muted">맞는 에이전트가 없어요.</p>;
  return (
    <ul className="agent-list">
      {shown.map((a) => (
        <li key={a.id} className="agent-row">
          <span>
            <b>{a.name}</b>
            {a.model && <span className="muted"> · {a.model}</span>}
            {a.hidden && (
              <span className="tag" style={{ marginLeft: 8 }}>
                {reasonPhrase(a.hidden)}
              </span>
            )}
          </span>
          <Go
            to={{ name: "agentVersions", connectionId: view.id, agentId: a.id }}
            aria-label={`${a.name}의 버전 기록`}
          >
            버전 기록
          </Go>
        </li>
      ))}
    </ul>
  );
}

/**
 * "에이전트 37개 · [이름으로 찾기] · 쉬는 중이라 숨겼어요 · 모두 보기": one line, with the list opening only when asked
 * (or when the search has something to show).
 */
export function AgentsLine({
  view,
  spec,
  mine,
  agents,
  onChanged,
  onPeek,
}: {
  readonly view: ConnectionView;
  readonly spec: ConnectorSpec | undefined;
  readonly mine: boolean;
  readonly agents: readonly AgentInfo[];
  readonly onChanged: () => void;
  readonly onPeek: (on: boolean) => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const persist = mine && spec?.fields.some((f) => f.key === "showHidden") === true;
  const showing = view.census.includesHidden || peek;
  const found = matchAgents(agents, query);
  const toggle = async () => {
    if (!persist) {
      setPeek(!peek);
      onPeek(!peek);
      return;
    }
    const body = { config: { ...view.config, showHidden: !view.census.includesHidden } };
    if (await run(() => api.call("updateConnection", { params: { id: view.id }, body }))) {
      setPeek(false);
      onPeek(false);
      onChanged();
    }
  };
  if (view.status !== "ok") return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="agents-line">
        <b>{agentLine(view)}</b>
        <input
          className="input agents-search"
          type="search"
          aria-label={`${view.name}의 에이전트 찾기`}
          placeholder="이름으로 찾기"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        {agents.length > 0 && (
          <Button
            data-moss-skip="폼과 대화상자 안"
            size="small"
            kind="quiet"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "목록 접기" : "목록 펼치기"}
          </Button>
        )}
      </div>
      <CensusRow census={view.census} showing={showing} onToggle={toggle} busy={busy} />
      {(open || query.trim() !== "") && (
        <>
          <AgentList view={view} agents={found} all={query.trim() !== "" || found.length <= 20} />
          {query.trim() === "" && found.length > 20 && (
            <p className="small muted">처음 {AGENT_PREVIEW}개만 보여요. 이름으로 찾아 보세요.</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Why some agents are not in the list, in one line with "모두 보기" beside it; the harness's own notes wait under
 * "더 알아보기" so the card stays a card.
 */
function CensusRow(props: {
  readonly census: ConnectionView["census"];
  readonly showing: boolean;
  readonly onToggle: () => void;
  readonly busy: boolean;
}) {
  const text = censusText(props.census, props.showing);
  const [why, ...notes] = text.lines;
  if (props.census.total > 0 && !text.action && notes.length === 0 && !why) return null;
  const empty = props.census.total === 0;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className={`small ${empty ? "" : "muted"}`}>{empty ? text.headline : why}</span>
        {text.action && (
          <Button
            data-moss-skip="폼과 대화상자 안"
            size="small"
            kind="quiet"
            busy={props.busy}
            onClick={props.onToggle}
          >
            {text.action}
          </Button>
        )}
      </div>
      {(empty ? text.lines : notes).length > 0 && (
        <details className="fold">
          <summary className="small">더 알아보기</summary>
          <ul className="list-plain small muted" style={{ marginTop: 6 }}>
            {(empty ? text.lines : notes).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Badges({ view }: { readonly view: ConnectionView }) {
  const expiry = expiryOf(view);
  const ownerOf = useOwnerName();
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
      <span className="tag">
        {view.source === "config" ? "서버 설정" : `만든 사람 ${ownerOf(view.owner ?? "")}`}
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

function Upkeep({
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
      <Button
        data-moss-skip="폼과 대화상자 안"
        size="small"
        busy={busy}
        onClick={() => act("recheckConnection", "다시 확인했어요")}
      >
        다시 확인
      </Button>
      {view.source === "screen" && (
        <Button
          data-moss-skip="폼과 대화상자 안"
          size="small"
          busy={busy}
          onClick={() => act("keepConnection", "계속 쓰기로 했어요")}
        >
          계속 쓰기
        </Button>
      )}
      {mine && (
        <>
          <ScopeButton
            kind="connection"
            id={view.id}
            name={view.name}
            {...(view.owner ? { owner: view.owner } : {})}
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
      )}
    </div>
  );
}

function StatusLine({ view }: { readonly view: ConnectionView }) {
  const now = useNow();
  const when = view.lastUsedAt
    ? `마지막 사용 ${relativeTime(view.lastUsedAt, now)}`
    : "아직 안 썼어요";
  return (
    <div className="small muted">
      {KIND_CARDS.find((k) => k.kind === view.connector)?.name ?? view.connector} ·{" "}
      {ADDRESS_LABELS[addressKind(view)]} · {when}
      {view.traces.kind !== "none" && ` · ${tracesLabel(view.traces)}`}
    </div>
  );
}

/** The top line of a card: the name and how it stands, then "말 걸어 보기" first and "설정" after it. */
function CardHead(props: {
  readonly view: ConnectionView;
  readonly talk: boolean;
  readonly manage: boolean;
  readonly why: string | undefined;
  readonly reference: boolean;
  readonly setTalk: (on: boolean) => void;
  readonly setManage: (on: boolean) => void;
}) {
  const { view, talk, manage, why, reference } = props;
  return (
    <div className="conn-head">
      <div>
        <h2 style={{ margin: 0 }}>
          {view.name}
          <ScopeTag item={view.sharing} />{" "}
          <ToneDot tone={view.status === "ok" ? "good" : "bad"}>
            {view.status === "ok" ? "연결됨" : "연결 안 됨"}
          </ToneDot>
        </h2>
        <StatusLine view={view} />
        {view.description && (
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {view.description}
          </p>
        )}
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {!reference && (
          <Button
            data-moss-skip="폼과 대화상자 안"
            kind="primary"
            size="small"
            aria-expanded={talk}
            disabled={why !== undefined}
            {...(why ? { why } : {})}
            onClick={() => props.setTalk(!talk)}
          >
            말 걸어 보기
          </Button>
        )}
        <Button
          data-moss-skip="폼과 대화상자 안"
          size="small"
          aria-expanded={manage}
          onClick={() => props.setManage(!manage)}
        >
          설정
        </Button>
      </div>
    </div>
  );
}

export function ConnectionCard({
  view,
  spec,
  onEdit,
  onDelete,
  onChanged,
  reference = false,
}: {
  readonly view: ConnectionView;
  readonly spec: ConnectorSpec | undefined;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onChanged: () => void;
  /** A built-in reference agent: no "말 걸어 보기", since it only plays a script. */
  readonly reference?: boolean;
}) {
  // the maker and administrators change a connection made on the screen; the server says which this person is
  const mine = view.source === "screen" && view.sharing.canChange;
  const [talk, setTalk] = useState(false);
  const [manage, setManage] = useState(false);
  const [peek, setPeek] = useState(false);
  const agents = peek ? [...view.agents, ...view.hiddenAgents] : view.agents;
  return (
    <section className="panel panel-pad conn-card" aria-label={view.name}>
      <div className="stack" style={{ gap: 12 }}>
        <CardHead
          view={view}
          talk={talk}
          manage={manage}
          why={whyNot(view, agents.length)}
          reference={reference}
          setTalk={setTalk}
          setManage={setManage}
        />
        {view.status === "unreachable" && (
          <Note tone="bad">
            {view.error ?? "연결하지 못했어요. '다시 확인'을 눌러 한 번 더 해 보세요."}
          </Note>
        )}
        {talk && !reference && <TryPanel view={view} agents={agents} />}
        <AgentsLine
          view={view}
          spec={spec}
          mine={mine}
          agents={agents}
          onChanged={onChanged}
          onPeek={setPeek}
        />
        {manage && (
          <div className="stack conn-manage" style={{ gap: 12 }}>
            <Badges view={view} />
            <Pairs view={view} />
            <Upkeep
              view={view}
              mine={mine}
              onEdit={onEdit}
              onDelete={onDelete}
              onChanged={onChanged}
            />
          </div>
        )}
      </div>
    </section>
  );
}
