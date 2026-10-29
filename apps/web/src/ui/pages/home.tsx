/**
 * Home: what Terrarium is for, the three things to do in order, and what is happening now. A small
 * read-only view of a world sits beside the title when there is one (REQ-006).
 */
import { lazy, Suspense } from "react";
import { Go, useApp, useAsync } from "../context";
import { Loading, Section } from "../kit";
import { ExperimentTable } from "./experiments";

const Vitrine = lazy(() => import("./Vitrine"));

const STARTS = [
  {
    page: { name: "worlds" } as const,
    title: "세계를 짓는다",
    body: "사업장에서 건물, 층, 서버룸, 랙까지 끌어다 놓거나, 크기만 정해 자동으로 만들거나, 실제 구성에서 읽어 온다.",
  },
  {
    page: { name: "scenarios" } as const,
    title: "일어날 일을 그린다",
    body: "팬이 멈추고 차단기가 내려가는 순서를 블록으로 잇고, 에이전트가 무엇을 해야 점수를 받는지 정한다.",
  },
  {
    page: { name: "newExperiment" } as const,
    title: "에이전트를 시험한다",
    body: "하네스, 에이전트, 쓸 수 있는 툴을 고르면 같은 상황에서 여러 번 돌려 결과를 비교해 준다.",
  },
];

function Hero() {
  const { api } = useApp();
  const worlds = useAsync((signal) => api.call("listWorlds", { signal }), []);
  const newest = [...(worlds.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return (
    <div className="home-hero">
      <div className="stack" style={{ gap: 18 }}>
        <h1 className="home-title">진짜 장비를 건드리지 않고 에이전트의 장애 대응을 시험한다</h1>
        <p className="lede">
          테라리움은 데이터센터를 흉내 내는 작은 세계다. 여기에 장애를 일으키고, 에이전트가 원인을
          찾아내는 과정을 기록하고 채점한다.
        </p>
        <div className="row">
          <Go to={{ name: "newExperiment" }} className="btn btn-primary">
            새 실험
          </Go>
          <Go to={{ name: "worlds" }} className="btn">
            세계 보기
          </Go>
        </div>
      </div>
      {newest && (
        <Suspense fallback={<Loading lines={4} />}>
          <Vitrine worldId={newest.id} caption={newest.name} />
        </Suspense>
      )}
    </div>
  );
}

function Starts() {
  return (
    <nav className="starts" aria-label="시작하는 순서">
      {STARTS.map((s) => (
        <Go key={s.page.name} to={s.page} className="start">
          <span className="start-title">{s.title}</span>
          <span className="small muted">{s.body}</span>
        </Go>
      ))}
    </nav>
  );
}

function Recent() {
  const { api, me, meta } = useApp();
  const list = useAsync(
    (signal) => api.call("listExperiments", { query: { limit: 8 }, signal }),
    [],
  );
  const queue = meta?.queue;
  return (
    <Section title="최근 실험" aside={<Go to={{ name: "experiments" }}>전부 보기</Go>}>
      {queue && (queue.running > 0 || queue.queued > 0) && (
        <p className="small muted" style={{ marginBottom: 10 }}>
          지금 {queue.running}회 실행 중, {queue.queued}회 대기.
          {me && ` ${me}님의 차례도 공평하게 돌아간다.`}
        </p>
      )}
      {!list.data && !list.error && <Loading />}
      {list.data?.length === 0 && (
        <p className="muted small">아직 실험이 없다. 위의 세 단계를 차례로 해 본다.</p>
      )}
      {list.data && list.data.length > 0 && <ExperimentTable items={list.data} />}
    </Section>
  );
}

export function HomePage() {
  return (
    <div className="page">
      <Hero />
      <Starts />
      <Recent />
    </div>
  );
}
