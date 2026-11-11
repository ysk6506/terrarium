/**
 * The sections of an experiment's page (REQ-037, REQ-040): the numbers, what was fixed and what was
 * learned, the runs (live while they run), the scoring sheet's hit rates, and the family tree.
 */
import {
  type ExperimentAnalysis,
  endLabelOf,
  type ParentComparison,
} from "@terrarium/core/analysis";
import type { ExperimentView, RunSummary } from "@terrarium/core/contract";
import { END_REASON_LABELS } from "@terrarium/core/oracle";
import { describeLeadSettings, domainInfo } from "@terrarium/core/world";
import {
  formatDuration,
  type LiveState,
  meanText,
  PASS_SHARE_TEXT,
  percent,
  scoreText,
} from "../../logic";
import { Go } from "../context";
import { Figures, Note, Section, Status } from "../kit";
import { RateBar, ScoreBar } from "../results";
import { ExperimentTable } from "./experiments";

export function ResultFigures({ a }: { readonly a: ExperimentAnalysis }) {
  const done = a.progress.completed;
  return (
    <Figures
      items={[
        {
          label: "합격률",
          value: done > 0 ? percent(a.passRate) : "—",
          hint: PASS_SHARE_TEXT,
        },
        {
          label: "평균 점수",
          value: meanText(a.score, "점"),
          hint: "오차는 95% 신뢰구간. 실행이 적으면 넓어요",
        },
        {
          label: "정확한 진단",
          value: done > 0 ? percent(a.diagnosisRate) : "—",
          hint: "원인 장비와 고장 종류를 모두 맞힌 실행의 비율",
        },
        { label: "툴 호출", value: meanText(a.calls, "회", 0), hint: "실행마다 부른 횟수" },
        {
          label: "진단까지",
          value: a.timeToDiagnosis ? formatDuration(a.timeToDiagnosis.mean) : "—",
          hint: "시뮬레이션 시간으로 과제를 받고 진단을 낼 때까지",
        },
        {
          label: "토큰",
          value: a.tokens ? Math.round(a.tokens.mean).toLocaleString("ko-KR") : "—",
          hint: "하네스가 알려 준 입력과 출력 토큰의 합",
        },
      ]}
    />
  );
}

export function Findings({ items }: { readonly items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <Section title="알아낸 것">
      <ul className="list-plain">
        {items.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </Section>
  );
}

export function ParentCard({
  parent,
  ready,
}: {
  readonly parent: ParentComparison;
  readonly ready: boolean;
}) {
  const sign = (n: number, unit: string, digits = 1) =>
    `${n > 0 ? "+" : ""}${n.toFixed(digits)}${unit}`;
  return (
    <Section
      title="원본과 견주면"
      aside={<Go to={{ name: "experiment", id: parent.experimentId }}>{parent.name} 보기</Go>}
    >
      <div className="panel panel-pad stack">
        <div className="diff">
          {parent.changes.map((c) => (
            <div key={c.field} style={{ display: "contents" }}>
              <b>{c.label}</b>
              <span>
                <span className="diff-before">{c.before}</span> → {c.after}
              </span>
            </div>
          ))}
        </div>
        <p className="small">
          {ready ? (
            <>
              합격률 {sign(parent.passRateDelta * 100, "%p", 0)}
              {parent.scoreDelta !== undefined && `, 평균 점수 ${sign(parent.scoreDelta, "점")}`}.{" "}
              {parent.clear
                ? "두 실험의 오차 범위가 겹치지 않아 차이가 분명해요."
                : "오차 범위가 겹쳐서 아직 차이가 있다고 말하기 어려워요."}
            </>
          ) : (
            "끝난 실행이 생기면 원본과 견줘요."
          )}
        </p>
      </div>
    </Section>
  );
}

export function EndReasons({ analysis }: { readonly analysis: ExperimentAnalysis }) {
  const entries = Object.entries(analysis.endReasons) as [keyof typeof END_REASON_LABELS, number][];
  if (entries.length === 0) return null;
  return (
    <p className="small muted">
      끝난 이유: {entries.map(([reason, n]) => `${endLabelOf(analysis, reason)} ${n}회`).join(", ")}
    </p>
  );
}

function CallTicker({ calls }: { readonly calls: LiveState["calls"][string] | undefined }) {
  if (!calls || calls.length === 0) return <span className="tiny muted">기다리는 중</span>;
  return (
    <span className="live-calls">
      {calls.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the ticker is an append-only window
        <span key={i} className={`live-call${c.ok ? "" : " live-call-bad"}`} title={c.error}>
          {c.tool}
        </span>
      ))}
    </span>
  );
}

const answerText = (d: { submitted: boolean; root: boolean; type: boolean }) => {
  if (!d.submitted) return "진단 없이 끝났어요";
  if (d.root && d.type) return "원인과 종류를 모두 맞혔어요";
  if (d.root) return "원인만 맞혔어요";
  return d.type ? "종류만 맞혔어요" : "원인과 종류 모두 틀렸어요";
};

function runNote(run: RunSummary, analysis: ExperimentAnalysis, calls: LiveState["calls"]) {
  if (run.status === "queued")
    return (
      <span className="tiny muted">
        {run.queuePosition ? `${run.queuePosition}번째 차례` : "대기"}
      </span>
    );
  if (run.status === "running") return <CallTicker calls={calls[run.id]} />;
  if (run.error) return <span className="small">{run.error}</span>;
  const a = analysis.runs.find((r) => r.runId === run.id);
  if (!a || run.status !== "completed") return null;
  const why = a.endReason ? `${a.endLabel ?? END_REASON_LABELS[a.endReason]}, ` : "";
  return <span className="small">{`${why}${answerText(a.diagnosis)}`}</span>;
}

export function RunsTable({
  runs,
  live,
  analysis,
  picked,
  onPick,
}: {
  readonly runs: readonly RunSummary[];
  readonly live: LiveState | undefined;
  readonly analysis: ExperimentAnalysis;
  /** The runs ticked for the side-by-side view (REQ-078). */
  readonly picked: readonly string[];
  readonly onPick: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>
              <span className="sr-only">나란히 보기에 넣기</span>
            </th>
            <th className="num" style={{ width: 48 }}>
              #
            </th>
            <th>상태</th>
            <th className="num">시드</th>
            <th className="num">점수</th>
            <th>결과</th>
            <th>
              <span className="sr-only">자세히</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                {r.status === "completed" && (
                  <label className="hit-box">
                    <input
                      type="checkbox"
                      checked={picked.includes(r.id)}
                      onChange={() => onPick(r.id)}
                      aria-label={`${r.index + 1}번째 실행을 나란히 보기에 넣기`}
                    />
                  </label>
                )}
              </td>
              <td className="num">{r.index + 1}</td>
              <td>
                <Status
                  status={r.status}
                  operation={analysis.experiment.recipe.operation !== undefined}
                />
              </td>
              <td className="num">{r.seed}</td>
              <td className="num">
                {r.status === "completed" ? scoreText(r.score) : "—"}
                {r.status === "completed" && (
                  <span className="sr-only">{r.passed ? ", 합격" : ", 불합격"}</span>
                )}
              </td>
              <td>{runNote(r, analysis, live?.calls ?? {})}</td>
              <td>
                {r.status !== "queued" && (
                  <Go to={{ name: "run", id: r.id }}>
                    들여다보기<span className="sr-only"> ({r.index + 1}번째 실행)</span>
                  </Go>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CriteriaTable({ criteria }: { readonly criteria: ExperimentAnalysis["criteria"] }) {
  if (criteria.length === 0) return null;
  return (
    <Section
      title="채점 항목별로"
      aside={<span className="tiny muted">감점 항목은 피한 비율이에요</span>}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>항목</th>
              <th>해낸 비율</th>
              <th className="num">평균 점수</th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>
                  <RateBar rate={c.rate} />
                </td>
                <td className="num">
                  {c.meanPoints} / {c.max || "감점"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function Lineage({ view }: { readonly view: ExperimentView }) {
  if (view.ancestors.length === 0 && view.forks.length === 0) return null;
  return (
    <Section title="계보">
      {view.ancestors.length > 0 && (
        <div className="stack" style={{ marginBottom: 16 }}>
          <h3 className="small">이 실험이 나온 곳</h3>
          <ExperimentTable items={view.ancestors} />
        </div>
      )}
      {view.forks.length > 0 && (
        <div className="stack">
          <h3 className="small">여기서 조건을 바꿔 돌린 실험</h3>
          <ExperimentTable items={view.forks} />
        </div>
      )}
    </Section>
  );
}

export function ConditionsPanel({ view }: { readonly view: ExperimentView }) {
  const { recipe, snapshot } = view.experiment;
  const score = view.analysis.score;
  return (
    <Section
      title="시험한 조건"
      aside={
        score &&
        score.n > 1 && (
          <span className="row tiny muted">
            점수 분포 <ScoreBar summary={score} />
          </span>
        )
      }
    >
      <dl className="keys">
        <div>
          <dt>세계</dt>
          <dd>
            <Go to={{ name: "world", id: recipe.worldId }}>{snapshot.worldName}</Go>
          </dd>
        </div>
        <div>
          <dt>시나리오</dt>
          <dd>
            <Go to={{ name: "scenario", id: recipe.scenarioId }}>{snapshot.scenarioName}</Go>
          </dd>
        </div>
        <div>
          <dt>하네스와 에이전트</dt>
          <dd>
            {recipe.harnessId} / {recipe.agentId}
          </dd>
        </div>
        <div>
          <dt>툴</dt>
          <dd>{recipe.tools.join(", ")}</dd>
        </div>
        <div>
          <dt>시간</dt>
          <dd>
            {recipe.time.kind === "lockstep"
              ? `툴 호출 한 번에 ${formatDuration(recipe.time.secondsPerCall)} (재현됨)`
              : `실제 시간 ${recipe.time.speed}배속 (재현되지 않음)`}
          </dd>
        </div>
        {recipe.domains && recipe.domains.length > 0 && (
          <div>
            <dt>내 도메인</dt>
            <dd>{recipe.domains.map((d) => domainInfo(d).label).join(", ")}</dd>
          </div>
        )}
        {recipe.domains && recipe.domains.length > 0 && (
          <div>
            <dt>SLA·예비 부품·팀</dt>
            <dd>{describeLeadSettings(recipe.leadTimes)}</dd>
          </div>
        )}
      </dl>
      {view.experiment.note && <Note>{view.experiment.note}</Note>}
    </Section>
  );
}
