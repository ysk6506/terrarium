/**
 * Home: what Terrarium is for, the three things to do in order, and what is happening now. A small
 * read-only view of a world sits beside the title when there is one (REQ-006).
 */
import { lazy, Suspense, useState } from "react";
import { pickHeadline, STARTS } from "../../logic";
import { Go, useApp, useAsync } from "../context";
import { Loading, Section } from "../kit";
import { SleepPill, useAwake } from "../moss/Launcher";
import { EscalationCards } from "./escalation";
import { ExperimentTable } from "./experiments";
import { OperationCards } from "./operation-card";
import { WorldBoard } from "./world-board";

const Vitrine = lazy(() => import("./Vitrine"));

function Hero() {
  const { api } = useApp();
  const worlds = useAsync((signal) => api.call("listWorlds", { signal }), []);
  const newest = [...(worlds.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  // One headline per visit: it must not change while someone is reading it.
  const [headline] = useState(() => pickHeadline());
  const awake = useAwake();
  return (
    <div className="home-hero">
      <div className="stack" style={{ gap: 18 }}>
        <h1 className="home-title">{headline.title}</h1>
        <p className="lede">{headline.lede}</p>
        <div className="row">
          <Go
            data-moss-action="go-new-experiment"
            to={{ name: "newExperiment" }}
            className="btn btn-primary"
          >
            새 실험
          </Go>
          <Go data-moss-action="go-worlds" to={{ name: "worlds" }} className="btn">
            세계 보기
          </Go>
        </div>
        {!awake && (
          <p className="moss-sleep-line">
            <SleepPill />
          </p>
        )}
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
        <Go key={s.page} to={{ name: s.page }} className="start">
          <span className="start-title">{s.title}</span>
          <span className="small muted">{s.body}</span>
        </Go>
      ))}
    </nav>
  );
}

/** The operations going now, one check-in card each (REQ-090). */
function Operating() {
  const { api } = useApp();
  const list = useAsync(
    (signal) => api.call("listExperiments", { query: { limit: 8 }, signal }),
    [],
  );
  const going = (list.data ?? []).filter(
    (s) => s.status === "running" && s.experiment.recipe.operation,
  );
  if (going.length === 0) return null;
  return (
    <Section title="지금 돌고 있는 운영">
      <div className="stack">
        {going.map((s) => (
          <RunningOperation key={s.experiment.id} id={s.experiment.id} />
        ))}
      </div>
    </Section>
  );
}

function RunningOperation({ id }: { readonly id: string }) {
  const { api } = useApp();
  const view = useAsync((signal) => api.call("getExperiment", { params: { id }, signal }), [id]);
  const recipe = view.data?.experiment.recipe;
  if (!view.data || !recipe?.operation) return null;
  return (
    <OperationCards
      runs={view.data.runs}
      worldId={recipe.worldId}
      hours={recipe.operation.hours}
      title={view.data.experiment.name}
    />
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
          지금 {queue.running}번 실행 중, {queue.queued}번 대기.
          {me && ` ${meta?.user.name ?? me}님의 차례도 공평하게 돌아가요.`}
        </p>
      )}
      {!list.data && !list.error && <Loading />}
      {list.data?.length === 0 && (
        <p className="muted small">아직 실험이 없어요. 위의 세 단계를 차례로 해 보세요.</p>
      )}
      {list.data && list.data.length > 0 && (
        <ExperimentTable items={list.data} showTitles={false} />
      )}
    </Section>
  );
}

export function HomePage() {
  return (
    <div className="page">
      <EscalationCards />
      <Hero />
      <Starts />
      <Operating />
      <WorldBoard limit={3} />
      <Recent />
    </div>
  );
}
