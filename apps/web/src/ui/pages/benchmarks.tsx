/**
 * Benchmarks (REQ-039, REQ-040, REQ-015): configurations ranked against each other, but only inside one
 * benchmark set, the same world, scenario, oracle and time policy. From any row an experiment can be
 * forked to try one condition changed. The twin exports (diagnosis records, modelling brief) live here too.
 */
import type { Leaderboard, LeaderboardRow } from "@terrarium/core/analysis";
import { MIN_RUNS_TO_RANK } from "@terrarium/core/analysis";
import { formatDuration, meanText, percent } from "../../logic";
import { Go, useApp, useAsync } from "../context";
import { Empty, Failure, Loading, PageHead, Section, SelectField } from "../kit";
import { ScoreBar } from "../results";

/** Which benchmark set: the world and the scenario every row was run on. */
const setTitle = (b: Leaderboard) => `${b.snapshot.worldName}, ${b.snapshot.scenarioName}`;

const timeText = (b: Leaderboard) =>
  b.time.kind === "lockstep"
    ? `툴 호출마다 ${formatDuration(b.time.secondsPerCall)} 흐름`
    : `실제 시간 ${b.time.speed}배속`;

function Row({
  row,
  name,
}: {
  readonly row: LeaderboardRow;
  readonly name: (h: string, a: string) => string;
}) {
  return (
    <tr>
      <td className="num">
        {row.rank ? (
          <span className="rank">{row.rank}</span>
        ) : (
          <span className="tiny muted">순위 전</span>
        )}
      </td>
      <td>
        <Go to={{ name: "experiment", id: row.latest }}>{name(row.harnessId, row.agentId)}</Go>
        <div className="tiny muted">
          {row.harnessId}, 툴 {row.tools.length}개
        </div>
      </td>
      <td className="num">
        {row.runs}회{!row.rank && <div className="tiny muted">{MIN_RUNS_TO_RANK}회부터 순위</div>}
      </td>
      <td className="num">{percent(row.passRate)}</td>
      <td>
        <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
          <span className="num">{meanText(row.score, "점")}</span>
          {row.score && row.score.n > 1 && <ScoreBar summary={row.score} width={110} />}
        </div>
      </td>
      <td className="num">{meanText(row.calls, "회", 0)}</td>
      <td className="num">
        {row.timeToDiagnosis ? formatDuration(row.timeToDiagnosis.mean) : "—"}
      </td>
      <td className="num">
        {row.tokens ? Math.round(row.tokens.mean).toLocaleString("ko-KR") : "—"}
      </td>
      <td className="small">{row.owners.join(", ")}</td>
      <td>
        <Go to={{ name: "newExperiment", forkOf: row.latest }}>
          조건 바꿔 해 보기<span className="sr-only"> ({name(row.harnessId, row.agentId)})</span>
        </Go>
      </td>
    </tr>
  );
}

function Board({ board, highlight }: { readonly board: Leaderboard; readonly highlight: boolean }) {
  const { meta } = useApp();
  const name = (h: string, a: string) =>
    meta?.harnesses.find((x) => x.id === h)?.agents.find((x) => x.id === a)?.name ?? a;
  return (
    <section
      className="section"
      id={board.benchmarkKey}
      aria-labelledby={`b-${board.benchmarkKey}`}
    >
      <div className="section-head">
        <h2 id={`b-${board.benchmarkKey}`}>{setTitle(board)}</h2>
        <span className="tiny muted">
          {timeText(board)}, 실행 {board.runs}회{highlight ? ", 골라 본 세트" : ""}
        </span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="num">순위</th>
              <th>에이전트</th>
              <th className="num">실행</th>
              <th className="num">합격률</th>
              <th>평균 점수 (95% 구간)</th>
              <th className="num">툴 호출</th>
              <th className="num">진단까지</th>
              <th className="num">토큰</th>
              <th>실험한 사람</th>
              <th>
                <span className="sr-only">이어서</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <Row key={`${r.harnessId}|${r.agentId}|${r.tools.join(",")}`} row={r} name={name} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TwinExports() {
  const { api } = useApp();
  return (
    <Section title="시뮬레이터를 더 현실에 가깝게">
      <p className="small muted" style={{ maxWidth: 640 }}>
        모든 실험에서 에이전트가 무엇을 물었고 어디서 막혔는지 모아, 시뮬레이터에 무엇이 모자란지
        알려 줘요. 현실 장비는 건드리지 않고 이 기록만 읽어요.
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <a className="btn" href={api.url("twinBrief")} download="terrarium-modeling-brief.md">
          모델링 브리프 받기
        </a>
        <a className="btn" href={api.url("twinDiagnoses")} download="terrarium-diagnoses.jsonl">
          진단 기록 받기 (JSONL)
        </a>
      </div>
    </Section>
  );
}

export function BenchmarksPage() {
  const { api, page, navigate } = useApp();
  const set = page.name === "benchmarks" ? page.set : undefined;
  const data = useAsync((signal) => api.call("leaderboards", { signal }), []);
  const boards = data.data ?? [];
  const shown = set ? boards.filter((b) => b.benchmarkKey === set) : boards;
  return (
    <div className="page">
      <PageHead
        title="벤치마크"
        lede="같은 세계, 같은 시나리오, 같은 채점표에서 돌린 실험끼리만 순위를 매겨요. 오차 범위가 겹치면 차이가 있다고 하지 않아요."
        actions={
          <Go to={{ name: "newExperiment" }} className="btn btn-primary">
            새 실험
          </Go>
        }
      />
      {boards.length > 1 && (
        <div style={{ maxWidth: 420, marginBottom: 16 }}>
          <SelectField
            label="벤치마크 세트"
            value={set ?? ""}
            options={[
              { value: "", label: "모든 세트" },
              ...boards.map((b) => ({ value: b.benchmarkKey, label: setTitle(b) })),
            ]}
            onChange={(v) =>
              navigate({ name: "benchmarks", ...(v ? { set: v } : {}) }, { replace: true })
            }
          />
        </div>
      )}
      {data.error && <Failure error={data.error} retry={data.reload} />}
      {!data.data && !data.error && <Loading lines={5} />}
      {data.data && boards.length === 0 && (
        <Empty
          title="아직 순위를 매길 실험이 없어요"
          action={
            <Go to={{ name: "newExperiment" }} className="btn btn-primary">
              첫 실험 만들기
            </Go>
          }
        >
          실험이 끝나면 여기에 세트별로 모여요. 같은 조건을 {MIN_RUNS_TO_RANK}회 이상 돌려야 순위에
          올라요.
        </Empty>
      )}
      {shown.map((b) => (
        <Board key={b.benchmarkKey} board={b} highlight={b.benchmarkKey === set} />
      ))}
      <TwinExports />
    </div>
  );
}
