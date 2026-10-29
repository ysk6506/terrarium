/** Experiments (REQ-030): everyone's, newest first, or only mine; status and results at a glance. */
import type { ExperimentSummary } from "@terrarium/core/contract";
import { useState } from "react";
import { percent, relativeTime, scoreText } from "../../logic";
import { Go, useApp, useAsync, useNow } from "../context";
import { Button, Empty, Failure, Loading, PageHead, Segmented, Status } from "../kit";

export function progressText(s: ExperimentSummary): string {
  const p = s.progress;
  if (p.finished === p.total) return `${p.total}회 끝`;
  return `${p.finished}/${p.total}회${p.running > 0 ? `, ${p.running}회 실행 중` : ""}`;
}

export function ExperimentTable({
  items,
  showOwner = true,
}: {
  readonly items: readonly ExperimentSummary[];
  readonly showOwner?: boolean;
}) {
  const now = useNow();
  const { meta } = useApp();
  const agentName = (h: string, a: string) =>
    meta?.harnesses.find((x) => x.id === h)?.agents.find((x) => x.id === a)?.name ?? a;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>상태</th>
            <th>시나리오</th>
            <th>에이전트</th>
            <th className="num">합격률</th>
            <th className="num">평균 점수</th>
            {showOwner && <th>만든 사람</th>}
            <th>만든 때</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.experiment.id}>
              <td>
                <Go to={{ name: "experiment", id: s.experiment.id }}>{s.experiment.name}</Go>
                {s.experiment.parentId && (
                  <span className="tag" style={{ marginLeft: 6 }}>
                    포크
                  </span>
                )}
              </td>
              <td>
                <Status status={s.status} /> <span className="tiny muted">{progressText(s)}</span>
              </td>
              <td>{s.experiment.snapshot.scenarioName}</td>
              <td>{agentName(s.experiment.recipe.harnessId, s.experiment.recipe.agentId)}</td>
              <td className="num">{s.progress.completed > 0 ? percent(s.passRate) : "—"}</td>
              <td className="num">{scoreText(s.meanScore)}</td>
              {showOwner && <td>{s.experiment.owner}</td>}
              <td>{relativeTime(s.experiment.createdAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_FILTERS = [
  { value: "", label: "전부" },
  { value: "running", label: "실행 중" },
  { value: "queued", label: "대기" },
  { value: "completed", label: "완료" },
  { value: "failed", label: "실패" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

export function ExperimentsPage() {
  const { api, page, navigate, me, askName } = useApp();
  const mine = page.name === "experiments" && page.mine === true;
  const [status, setStatus] = useState<StatusFilter>("");
  const list = useAsync(
    (signal) =>
      api.call("listExperiments", {
        query: { ...(mine && me ? { owner: me } : {}), ...(status ? { status } : {}), limit: 200 },
        signal,
      }),
    [mine, me, status],
  );
  return (
    <div className="page">
      <PageHead
        title="실험"
        lede="하네스, 에이전트, 툴 조합을 한 세계와 시나리오에 여러 번 돌린 기록."
        actions={
          <Go to={{ name: "newExperiment" }} className="btn btn-primary">
            새 실험
          </Go>
        }
      />
      <div className="row" style={{ marginBottom: 16, gap: 16 }}>
        <Segmented
          label="누구의 실험"
          value={mine ? "mine" : "all"}
          options={[
            { value: "all", label: "모두의 실험" },
            { value: "mine", label: "내 실험" },
          ]}
          onChange={(v) =>
            navigate(
              { name: "experiments", ...(v === "mine" ? { mine: true } : {}) },
              { replace: true },
            )
          }
        />
        <Segmented label="상태" value={status} options={STATUS_FILTERS} onChange={setStatus} />
      </div>
      {list.error && <Failure error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data?.length === 0 && (
        <Empty
          title={mine ? "아직 내 실험이 없다" : "조건에 맞는 실험이 없다"}
          action={
            <Go to={{ name: "newExperiment" }} className="btn btn-primary">
              실험 만들기
            </Go>
          }
        >
          세계와 시나리오를 고르고, 하네스와 에이전트를 정하면 바로 돈다.
        </Empty>
      )}
      {list.data && list.data.length > 0 && <ExperimentTable items={list.data} />}
      {mine && !me && (
        <p className="small muted" style={{ marginTop: 12 }}>
          이름을 정해야 내 실험을 고를 수 있다.{" "}
          <Button size="small" kind="quiet" onClick={askName}>
            이름 정하기
          </Button>
        </p>
      )}
    </div>
  );
}
