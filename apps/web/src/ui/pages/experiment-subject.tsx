/**
 * What the new-experiment form says about the one being tested (REQ-051, REQ-052, REQ-053): where to connect
 * when there is nothing to pick, whether running now would write a new version of the agent, and the
 * metadata that tells this experiment's results apart.
 */

import type { Experiment } from "@terrarium/core/experiments";
import type { experiment } from "../../logic";
import { metaProblems, pendingOf } from "../../logic";
import { Go, useApp, useAsync } from "../context";
import { Note, Section } from "../kit";
import { MetaEditor } from "./connection-form";

/** Nothing to pick: say where harnesses are connected. */
export function NoHarness() {
  return (
    <Note tone="warn">
      연결된 하네스가 없어요. <Go to={{ name: "connections" }}>연결 화면</Go>에서 시험할 하네스나
      에이전트를 먼저 연결해 주세요.
    </Note>
  );
}

/** Whether an experiment made now would write a new version of the agent, and what would differ. */
export function VersionPreview({
  harnessId,
  agentId,
}: {
  readonly harnessId: string;
  readonly agentId: string;
}) {
  const { api } = useApp();
  const history = useAsync(
    async (signal) => {
      try {
        return await api.call("listAgentVersions", { params: { id: harnessId, agentId }, signal });
      } catch (err) {
        // A harness with no connection record has no history to show; that is not an error here.
        if (signal.aborted) throw err;
        return undefined;
      }
    },
    [harnessId, agentId],
  );
  if (!history.data) return null;
  const p = pendingOf(history.data);
  return (
    <Note {...(p.tone === "plain" ? {} : { tone: p.tone })}>
      <div className="stack" style={{ gap: 6 }}>
        <span>
          {p.text}{" "}
          <Go to={{ name: "agentVersions", connectionId: harnessId, agentId }}>버전 기록 보기</Go>
        </span>
        {p.changes.length > 0 && (
          <ul className="list-plain small">
            {p.changes.map((c) => (
              <li key={c.field}>
                <b>{c.label}</b> <span className="diff-before">{c.before ?? "(없었어요)"}</span> →{" "}
                {c.after ?? "(없어졌어요)"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Note>
  );
}

/** Name=value pairs for this experiment; the connection's own metadata is attached as well. */
export function ExperimentMetadata({
  draft,
  set,
}: {
  readonly draft: experiment.Draft;
  readonly set: (change: Partial<experiment.Draft>) => void;
}) {
  return (
    <details className="fold" open={draft.metadata.length > 0 || undefined}>
      <summary>
        메타데이터 {draft.metadata.length > 0 ? `${draft.metadata.length}개` : "(선택)"}
      </summary>
      <div style={{ marginTop: 12 }}>
        <MetaEditor
          hint='이 실험에 붙는 이름표예요. 결과를 견줄 때 "무엇이 달랐나"를 가르는 데 써요(예: 프롬프트=v3).'
          rows={draft.metadata}
          problems={metaProblems(draft.metadata)}
          onChange={(metadata) => set({ metadata })}
        />
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          연결에 붙여 둔 메타데이터는 따로 적지 않아도 이 실험에 함께 남아요. 실험 목록에서 이름이나
          이름=값으로 걸러 볼 수 있어요.
        </p>
      </div>
    </details>
  );
}

/** Who was tested, as it was when the experiment was made, and the metadata that goes with the result. */
export function SubjectPanel({ experiment: e }: { readonly experiment: Experiment }) {
  const rows = Object.entries({ ...e.subject?.harness.metadata, ...e.metadata });
  const facts = Object.entries(e.subject?.agent.facts ?? {});
  if (!e.subject && rows.length === 0) return null;
  return (
    <Section title="시험한 대상">
      <div className="panel panel-pad stack">
        {e.subject && (
          <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
            <span>
              <b>{e.subject.agent.name}</b>
              {e.subject.agent.model ? ` (${e.subject.agent.model})` : ""}
            </span>
            <span className="muted">
              {e.subject.harness.name} · {e.subject.harness.kind}
            </span>
            {e.agentVersion !== undefined && (
              <Go
                to={{
                  name: "agentVersions",
                  connectionId: e.subject.harness.id,
                  agentId: e.subject.agent.id,
                }}
                className="tag"
                title="이 에이전트의 버전 기록"
              >
                v{e.agentVersion}
              </Go>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {rows.map(([k, v]) => (
              <span className="tag" key={k}>
                {k}={v}
              </span>
            ))}
          </div>
        )}
        {facts.length > 0 && (
          <details className="fold">
            <summary>하네스가 알린 에이전트 정보 {facts.length}개</summary>
            <dl className="diff" style={{ marginTop: 8 }}>
              {facts.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt className="muted">{k}</dt>
                  <dd style={{ margin: 0 }}>{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </Section>
  );
}
