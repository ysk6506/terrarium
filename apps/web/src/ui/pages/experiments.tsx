/** Experiments (REQ-030): everyone's, newest first, or only mine; status and results at a glance. */
import type { ExperimentSummary } from "@terrarium/core/contract";
import { useState } from "react";
import {
  matchesFilter,
  percent,
  progressWords,
  relativeTime,
  type ScopeFilter,
  scoreText,
} from "../../logic";
import { experimentsState, useMossRead } from "../../moss";
import { Go, useApp, useAsync, useNow } from "../context";
import { Segmented } from "../fields";
import { Button, Empty, Failure, Loading, PageHead, Status } from "../kit";
import { FilterEmpty, ScopeFilterBar, ScopeTag, useOwnerName } from "../scope";
import { TitlePills } from "../titles";

export const progressText = (s: ExperimentSummary): string => progressWords(s.status, s.progress);

/** The `name=value` pairs an experiment carries, small, under its name. */
export function MetaTags({ metadata }: { readonly metadata?: Readonly<Record<string, string>> }) {
  const rows = Object.entries(metadata ?? {});
  if (rows.length === 0) return null;
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {rows.map(([k, v]) => (
        <span className="tag" key={k}>
          {k}={v}
        </span>
      ))}
    </div>
  );
}

function ExperimentRow({
  s,
  showOwner,
  showTitles,
  now,
  agentName,
  ownerOf,
}: {
  readonly s: ExperimentSummary;
  readonly showOwner: boolean;
  readonly showTitles: boolean;
  readonly now: number;
  readonly agentName: (e: ExperimentSummary["experiment"]) => string;
  readonly ownerOf: (owner: string) => string;
}) {
  return (
    <tr>
      <td className="exp-name">
        <Go to={{ name: "experiment", id: s.experiment.id }}>{s.experiment.name}</Go>
        {s.experiment.parentId && (
          <span className="tag" style={{ marginLeft: 6 }}>
            포크
          </span>
        )}
        <ScopeTag item={s.experiment} />
        <MetaTags metadata={s.experiment.metadata} />
      </td>
      <td className="exp-status">
        <Status status={s.status} operation={s.experiment.recipe.operation !== undefined} />{" "}
        <span className="tiny muted">{progressText(s)}</span>
      </td>
      <td className="exp-scenario">{s.experiment.snapshot.scenarioName}</td>
      <td className="exp-agent">
        {agentName(s.experiment)}
        {s.experiment.agentVersion !== undefined && (
          <span className="tag" style={{ marginLeft: 6 }} title="실험을 만들 때의 에이전트 버전">
            v{s.experiment.agentVersion}
          </span>
        )}
      </td>
      <td className="num exp-pass">{s.progress.completed > 0 ? percent(s.passRate) : "—"}</td>
      <td className="num exp-mean">{scoreText(s.meanScore)}</td>
      {showOwner && (
        <td className="exp-owner">
          {ownerOf(s.experiment.owner)}
          {showTitles && <TitlePills who={s.experiment.owner} titles={s.ownerTitles ?? []} />}
        </td>
      )}
      <td className="exp-time">{relativeTime(s.experiment.createdAt, now)}</td>
    </tr>
  );
}

export function ExperimentTable({
  items,
  showOwner = true,
  showTitles = true,
}: {
  readonly items: readonly ExperimentSummary[];
  readonly showOwner?: boolean;
  /** 칭호 beside the owner's name (REQ-101); the home page leaves them out to stay quiet. */
  readonly showTitles?: boolean;
}) {
  const now = useNow();
  const { meta } = useApp();
  const ownerOf = useOwnerName();
  const agentName = (e: ExperimentSummary["experiment"]) =>
    e.subject?.agent.name ??
    meta?.harnesses
      .find((x) => x.id === e.recipe.harnessId)
      ?.agents.find((x) => x.id === e.recipe.agentId)?.name ??
    e.recipe.agentId;
  return (
    <div className="table-wrap">
      <table className="table experiments-table">
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
            <ExperimentRow
              key={s.experiment.id}
              s={s}
              showOwner={showOwner}
              showTitles={showTitles}
              now={now}
              agentName={agentName}
              ownerOf={ownerOf}
            />
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
  { value: "cancelled", label: "멈춤" },
  { value: "failed", label: "실패" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

/** Narrow the list to experiments that carry a `name=value` (or just a name) in their metadata (REQ-052). */
function MetaFilter({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(text.trim());
      }}
    >
      <input
        className="input"
        style={{ width: 240 }}
        aria-label="메타데이터로 거르기"
        placeholder="메타데이터 (팀=검색)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button data-moss-skip="세부 조절" size="small" type="submit">
        거르기
      </Button>
      {value && (
        <Button
          data-moss-skip="세부 조절"
          size="small"
          kind="quiet"
          onClick={() => {
            setText("");
            onChange("");
          }}
        >
          거르기 풀기
        </Button>
      )}
    </form>
  );
}

function NewExperiment({ children }: { readonly children: string }) {
  return (
    <Go
      data-moss-action="go-new-experiment"
      to={{ name: "newExperiment" }}
      className="btn btn-primary"
    >
      {children}
    </Go>
  );
}

function NeedName() {
  const { me, askName } = useApp();
  if (me) return null;
  return (
    <p className="small muted" style={{ marginTop: 12 }}>
      이름을 정해야 내 실험을 고를 수 있어요.{" "}
      <Button data-moss-skip="세부 조절" size="small" kind="quiet" onClick={askName}>
        이름 정하기
      </Button>
    </p>
  );
}

type ExperimentList = ReturnType<typeof useAsync<readonly ExperimentSummary[]>>;

/** What stands under the filters: the failure, the loading, the empty words, or the table. */
function ExperimentResults(props: {
  readonly list: ExperimentList;
  readonly shown: readonly ExperimentSummary[];
  readonly who: ScopeFilter;
  readonly mine: boolean;
  readonly onClear: () => void;
}) {
  const { list, shown, who, mine } = props;
  return (
    <>
      {list.error && <Failure error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && shown.length === 0 && who !== "all" && list.data.length > 0 && (
        <FilterEmpty filter={who} onClear={() => props.onClear()} />
      )}
      {list.data?.length === 0 && (
        <Empty
          title={mine ? "아직 내 실험이 없어요" : "조건에 맞는 실험이 없어요"}
          action={<NewExperiment>실험 만들기</NewExperiment>}
        >
          세계와 시나리오를 고르고, 하네스와 에이전트를 정하면 바로 돌아요.
        </Empty>
      )}
      {shown.length > 0 && <ExperimentTable items={shown} />}
      {mine && <NeedName />}
    </>
  );
}

export function ExperimentsPage() {
  const { api, page, navigate, me } = useApp();
  const [who, setWho] = useState<ScopeFilter>(
    page.name === "experiments" && page.mine === true ? "mine" : "all",
  );
  const mine = who === "mine";
  const [status, setStatus] = useState<StatusFilter>("");
  const [meta, setMeta] = useState("");
  const list = useAsync(
    (signal) =>
      api.call("listExperiments", {
        query: {
          ...(mine && me ? { owner: me } : {}),
          ...(status ? { status } : {}),
          ...(meta ? { meta } : {}),
          limit: 200,
        },
        signal,
      }),
    [mine, me, status, meta],
  );
  const shown = (list.data ?? []).filter((s) => matchesFilter(who, s.experiment, me));
  useMossRead("experiments", () => experimentsState(shown, mine));
  const choose = (next: ScopeFilter) => {
    setWho(next);
    navigate(
      { name: "experiments", ...(next === "mine" ? { mine: true } : {}) },
      { replace: true },
    );
  };
  return (
    <div className="page">
      <PageHead
        title="실험"
        lede="하네스, 에이전트, 툴 조합을 한 세계와 시나리오에 여러 번 돌린 기록."
        actions={<NewExperiment>새 실험</NewExperiment>}
      />
      <div className="scope-filter-row">
        <ScopeFilterBar value={who} onChange={choose} />
        <Segmented label="상태" value={status} options={STATUS_FILTERS} onChange={setStatus} />
        <MetaFilter value={meta} onChange={setMeta} />
      </div>
      <ExperimentResults
        list={list}
        shown={shown}
        who={who}
        mine={mine}
        onClear={() => choose("all")}
      />
    </div>
  );
}
