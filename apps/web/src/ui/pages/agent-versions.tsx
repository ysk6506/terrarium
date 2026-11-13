/**
 * The version history of one agent (REQ-053): every time an experiment was made, Terrarium looked at what the
 * agent says about itself and wrote a new version when it was different. People add versions for what it
 * cannot see (a changed system prompt), name them, and remove the ones that don't matter.
 */
import type { AgentHistoryView, AgentVersionView, ConnectionView } from "@terrarium/core/contract";
import { useState } from "react";
import {
  addRequest,
  canEditVersions,
  changeText,
  dateText,
  editRequest,
  isAdmin,
  metaProblems,
  pendingOf,
  type VersionForm,
  versionFormOf,
  versionTitle,
} from "../../logic";
import { Go, useAction, useApp, useAsync, usePageTitle } from "../context";
import {
  Button,
  Dialog,
  Empty,
  Failure,
  Loading,
  Note,
  PageHead,
  Section,
  TextField,
} from "../kit";
import { MetaEditor } from "./connection-form";

type Target = { readonly connectionId: string; readonly agentId: string };

function Changes({ changes }: { readonly changes: AgentVersionView["changes"] }) {
  return (
    <div className="diff">
      {changes.map((c) => {
        const t = changeText(c);
        return (
          <div key={c.field} style={{ display: "contents" }}>
            <b>{c.label}</b>
            <span>
              <span className="diff-before">{t.before}</span> → {t.after}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PendingBox({ history }: { readonly history: AgentHistoryView }) {
  const p = pendingOf(history);
  return (
    <Note tone={p.tone === "plain" ? undefined : p.tone}>
      <div className="stack" style={{ gap: 8 }}>
        <span>{p.text}</span>
        {p.changes.length > 0 && <Changes changes={p.changes} />}
      </div>
    </Note>
  );
}

function VersionFields({
  form,
  problems,
  onChange,
}: {
  readonly form: VersionForm;
  readonly problems: Readonly<Record<string, string>>;
  readonly onChange: (form: VersionForm) => void;
}) {
  return (
    <>
      <TextField
        label="이름표 (선택)"
        value={form.label}
        maxLength={60}
        placeholder="예: 프롬프트 v3"
        onChange={(label) => onChange({ ...form, label })}
      />
      <TextField
        label="메모 (선택)"
        value={form.note}
        multiline
        maxLength={500}
        placeholder="무엇을 어떻게 바꿨나"
        onChange={(note) => onChange({ ...form, note })}
      />
      <div className="stack" style={{ gap: 6 }}>
        <b>속성</b>
        <MetaEditor
          hint="테라리움이 볼 수 없는 차이를 이름=값으로 적어요(예: prompt=v3). 다음 버전으로 이어지고, 바뀐 점에도 나와요."
          rows={form.attributes}
          problems={problems}
          onChange={(attributes) => onChange({ ...form, attributes })}
        />
      </div>
    </>
  );
}

function VersionDialog({
  target,
  version,
  start,
  onClose,
  onDone,
}: {
  readonly target: Target;
  /** The version being changed; left out when adding one. */
  readonly version?: AgentVersionView;
  readonly start: VersionForm;
  readonly onClose: () => void;
  readonly onDone: (history: AgentHistoryView) => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const [form, setForm] = useState(start);
  const [shown, setShown] = useState(false);
  const problems = shown ? metaProblems(form.attributes) : {};
  const save = async () => {
    setShown(true);
    if (Object.keys(metaProblems(form.attributes)).length > 0) return;
    const params = { id: target.connectionId, agentId: target.agentId };
    const result = await run(
      () =>
        version
          ? api.call("editAgentVersion", {
              params: { ...params, n: String(version.n) },
              body: editRequest(form),
            })
          : api.call("addAgentVersion", { params, body: addRequest(form) }),
      version ? "버전을 고쳤어요" : "버전을 더했어요",
    );
    if (result) onDone(result);
  };
  return (
    <Dialog
      wide
      title={version ? `${versionTitle(version)} 고치기` : "버전 더하기"}
      onClose={onClose}
      actions={
        <>
          <Button data-moss-skip="폼과 대화상자 안" onClick={onClose}>
            닫기
          </Button>
          <Button data-moss-skip="폼과 대화상자 안" kind="primary" busy={busy} onClick={save}>
            저장
          </Button>
        </>
      }
    >
      <div className="stack">
        {!version && (
          <p className="small muted" style={{ margin: 0 }}>
            테라리움이 볼 수 없는 차이를 적어 둬요. 예를 들어 시스템 프롬프트를 고쳤다면 이름표와
            메모, 속성(prompt=v3)을 남겨요. 이 버전이 가장 새 버전이 되어, 에이전트가 밝힌 정보가
            바뀌지 않는 동안 이후 실험이 이 번호로 남아요.
          </p>
        )}
        <VersionFields form={form} problems={problems} onChange={setForm} />
      </div>
    </Dialog>
  );
}

function VersionCard({
  version,
  mayEdit,
  onEdit,
  onDelete,
}: {
  readonly version: AgentVersionView;
  readonly mayEdit: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const attrs = Object.entries(version.attributes);
  return (
    <article className="panel panel-pad" aria-label={versionTitle(version)}>
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{versionTitle(version)}</h3>
          {mayEdit && (
            <div className="row">
              <Button data-moss-skip="폼과 대화상자 안" size="small" onClick={onEdit}>
                이름·메모 고치기
              </Button>
              <Button
                data-moss-skip="폼과 대화상자 안"
                size="small"
                kind="danger"
                onClick={onDelete}
              >
                지우기
              </Button>
            </div>
          )}
        </div>
        <div className="row small muted" style={{ flexWrap: "wrap", gap: 12 }}>
          <span>{dateText(version.at)}</span>
          <span>
            {version.source === "auto" ? "실험을 만들 때 달라진 것을 찾았어요" : "사람이 더했어요"}
          </span>
          {version.by && <span>{version.by}</span>}
          <span>이 버전으로 돌린 실험 {version.experiments}개</span>
        </div>
        {version.note && <p style={{ margin: 0 }}>{version.note}</p>}
        {attrs.length > 0 && (
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {attrs.map(([k, v]) => (
              <span className="tag" key={k}>
                {k}={v}
              </span>
            ))}
          </div>
        )}
        {version.changes.length > 0 ? (
          <Changes changes={version.changes} />
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            처음 버전이라 견줄 앞 버전이 없어요.
          </p>
        )}
        <Snapshot snapshot={version.snapshot} />
      </div>
    </article>
  );
}

function Snapshot({ snapshot }: { readonly snapshot: AgentVersionView["snapshot"] }) {
  const rows = Object.entries(snapshot);
  if (rows.length === 0) return null;
  return (
    <details className="fold">
      <summary>이 버전에서 에이전트가 밝힌 정보 {rows.length}개</summary>
      <dl className="diff" style={{ marginTop: 8 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt className="muted">{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

type Dialogs =
  | { readonly kind: "add" }
  | { readonly kind: "edit"; readonly version: AgentVersionView }
  | { readonly kind: "delete"; readonly version: AgentVersionView }
  | undefined;

function DeleteVersion({
  version,
  target,
  onClose,
  onDone,
}: {
  readonly version: AgentVersionView;
  readonly target: Target;
  readonly onClose: () => void;
  readonly onDone: (history: AgentHistoryView) => void;
}) {
  const { api } = useApp();
  const { busy, run } = useAction();
  const remove = async () => {
    const result = await run(
      () =>
        api.call("deleteAgentVersion", {
          params: { id: target.connectionId, agentId: target.agentId, n: String(version.n) },
        }),
      "버전을 지웠어요",
    );
    if (result) onDone(result);
  };
  return (
    <Dialog
      title={`${versionTitle(version)}을 지울까`}
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
        번호는 다시 쓰이지 않아요. 이 버전으로 돌린 실험 {version.experiments}개는 그대로 남고, 이
        버전 뒤의 바뀐 점은 남아 있는 앞 버전과 견주어 다시 계산해요.
      </p>
    </Dialog>
  );
}

function Versions({
  history,
  target,
  mayEdit,
  set,
}: {
  readonly history: AgentHistoryView;
  readonly target: Target;
  readonly mayEdit: boolean;
  readonly set: (h: AgentHistoryView) => void;
}) {
  const [dialog, setDialog] = useState<Dialogs>();
  const done = (h: AgentHistoryView) => {
    set(h);
    setDialog(undefined);
  };
  const newest = history.versions[0];
  return (
    <>
      <Section
        title="버전"
        aside={
          mayEdit && (
            <Button
              data-moss-skip="폼과 대화상자 안"
              size="small"
              onClick={() => setDialog({ kind: "add" })}
            >
              버전 더하기
            </Button>
          )
        }
      >
        {history.versions.length === 0 ? (
          <Empty title="아직 버전이 없어요">
            이 에이전트로 실험을 만들면 그때 에이전트가 밝힌 정보로 v1이 생겨요.
          </Empty>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {history.versions.map((v) => (
              <VersionCard
                key={v.n}
                version={v}
                mayEdit={mayEdit}
                onEdit={() => setDialog({ kind: "edit", version: v })}
                onDelete={() => setDialog({ kind: "delete", version: v })}
              />
            ))}
          </div>
        )}
      </Section>
      {dialog?.kind === "add" && (
        <VersionDialog
          target={target}
          start={versionFormOf({ attributes: newest?.attributes ?? {} })}
          onClose={() => setDialog(undefined)}
          onDone={done}
        />
      )}
      {dialog?.kind === "edit" && (
        <VersionDialog
          target={target}
          version={dialog.version}
          start={versionFormOf(dialog.version)}
          onClose={() => setDialog(undefined)}
          onDone={done}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteVersion
          target={target}
          version={dialog.version}
          onClose={() => setDialog(undefined)}
          onDone={done}
        />
      )}
    </>
  );
}

export function AgentVersionsPage({ connectionId, agentId }: Target) {
  const { api, me, meta } = useApp();
  const history = useAsync(
    (signal) => api.call("listAgentVersions", { params: { id: connectionId, agentId }, signal }),
    [connectionId, agentId],
  );
  const connections = useAsync((signal) => api.call("listConnections", { signal }), []);
  const connection: ConnectionView | undefined = connections.data?.find(
    (c) => c.id === connectionId,
  );
  const agent = connection?.agents.find((a) => a.id === agentId);
  usePageTitle(`${agent?.name ?? agentId} 버전`);
  return (
    <div className="page">
      <PageHead
        crumbs={<Go to={{ name: "connections" }}>연결</Go>}
        title={`${agent?.name ?? agentId} 버전 기록`}
        lede={
          connection
            ? `${connection.name}에 있는 에이전트. 실험을 만들 때마다 에이전트가 밝힌 정보를 앞 버전과 견주어, 달라졌으면 새 버전으로 남겨요.`
            : undefined
        }
      />
      {history.error && <Failure error={history.error} retry={history.reload} />}
      {!history.data && !history.error && <Loading />}
      {history.data && (
        <div className="stack" style={{ gap: 20 }}>
          <PendingBox history={history.data} />
          <Versions
            history={history.data}
            target={{ connectionId, agentId }}
            mayEdit={canEditVersions(connection, me, isAdmin(meta))}
            set={history.set}
          />
        </div>
      )}
    </div>
  );
}
