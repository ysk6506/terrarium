/**
 * 화면의 지금 상태를 이끼가 읽을 JSON으로 (REQ-103, ADR-0124). 키는 한국어: 모델이 질문과 같은 말로 찾게 한다.
 * 순수한 함수라서 화면 없이 시험하고, 줄이는 한도(사건 30개, 채점표 전부)도 여기서 정한다.
 */
import type {
  ConnectionView,
  ExperimentSummary,
  ExperimentView,
  LeaderboardView,
  LlmModelView,
  RunView,
  WorldCardView,
} from "@terrarium/core/contract";
import type { ScenarioRecord } from "@terrarium/core/experiments";
import type { ShapeSpec } from "@terrarium/core/sources/worldgen";
import { type experiment, percent, scoreText, simTime } from "../logic";

const EVENTS = 30;

/** 한 실행: 점수와 채점표, 알아낸 것, 사건 기록(앞 30건). 결과 화면의 "왜 이 점수예요?"가 읽는 곳. */
export function runState(view: RunView) {
  const { run, analysis, experiment: e } = view;
  const result = run.result;
  return {
    화면: "실행 결과",
    실행: {
      번호: run.index + 1,
      시드: run.seed,
      상태: run.status,
      끝난_이유: analysis.endLabel ?? analysis.endReason ?? null,
      오류: run.error ?? null,
    },
    실험: { 이름: e.experiment.name, id: e.experiment.id },
    점수: scoreText(analysis.score),
    합격: result ? (analysis.passed ? "합격" : "불합격") : "아직",
    채점표: (result?.score.items ?? []).map((i) => ({
      항목: i.label,
      판정: i.verdict,
      점수: `${i.points}/${i.max || "감점"}`,
      이유: i.detail,
    })),
    채점_요약: result?.score.summary ?? null,
    알아낸_것: analysis.findings,
    효율: {
      조사_호출: `${analysis.efficiency.investigationCalls}회`,
      실패한_호출: `${analysis.efficiency.failedCalls}회`,
      같은_호출_반복: `${analysis.behaviour.repeated}회`,
    },
    사건_기록: view.timeline.slice(0, EVENTS).map((t) => `${simTime(t.t)} ${t.text}`),
    사건_기록_전체: view.timeline.length,
  };
}

const runLine = (r: ExperimentSummary) => ({
  id: r.experiment.id,
  이름: r.experiment.name,
  상태: r.status,
  진행: `${r.progress.finished}/${r.progress.total}회`,
  합격률: r.progress.completed > 0 ? percent(r.passRate) : null,
  평균_점수: r.meanScore === undefined ? null : `${r.meanScore.toFixed(1)}점`,
});

export function experimentsState(items: readonly ExperimentSummary[], mine: boolean) {
  return {
    화면: "실험 목록",
    내_실험만: mine,
    실험_수: items.length,
    실험: items.slice(0, 20).map(runLine),
  };
}

/** 한 실험: 합격률·평균 점수, 실행마다의 점수. */
export function experimentState(view: ExperimentView) {
  const a = view.analysis;
  return {
    화면: "실험 결과",
    ...runLine(view),
    실험_조건: {
      세계: view.experiment.recipe.worldId,
      시나리오: view.experiment.recipe.scenarioId,
      에이전트: view.experiment.recipe.agentId,
      툴: `${view.experiment.recipe.tools.length}개`,
      횟수: `${view.experiment.recipe.seeds.length}번`,
    },
    평균_점수: a.score
      ? `${a.score.mean.toFixed(1)}점 (오차 ±${a.score.ci95.toFixed(1)}, ${a.score.n}번)`
      : null,
    알아낸_것: a.findings,
    실행: view.runs.map((r) => ({
      번호: r.index + 1,
      id: r.id,
      시드: r.seed,
      상태: r.status,
      점수: scoreText(r.score),
      합격: r.passed ? "합격" : "불합격",
    })),
  };
}

export function worldsState(sort: string, cards: readonly WorldCardView[]) {
  return {
    화면: "세계 목록",
    순서: sort,
    세계_수: cards.length,
    세계: cards.slice(0, 20).map((c) => ({
      id: c.id,
      이름: c.name,
      좋아요: c.likes,
      최근_30일_실험: c.stats.experiments30d,
    })),
  };
}

export function scenariosState(items: readonly ScenarioRecord[]) {
  return {
    화면: "시나리오 목록",
    시나리오_수: items.length,
    시나리오: items.slice(0, 30).map((s) => ({ id: s.id, 이름: s.name, 세계: s.worldId })),
  };
}

export function connectionsState(items: readonly ConnectionView[]) {
  return {
    화면: "연결",
    연결_수: items.length,
    연결: items.map((c) => ({
      id: c.id,
      이름: c.name,
      종류: c.kind,
      상태: c.status,
      에이전트: c.agents.map((a) => a.name),
    })),
  };
}

/** 벤치마크 순위표: 세트마다 위 몇 줄의 순위와 점수 평균. */
export function benchmarksState(boards: readonly LeaderboardView[], set: string | undefined) {
  return {
    화면: "벤치마크",
    고른_세트: set ?? "모든 세트",
    세트: boards.slice(0, 8).map((b) => ({
      이름: b.title,
      실행_수: b.runs,
      순위: b.rows.slice(0, 5).map((r) => ({
        순위: r.rank ?? "아직 실행이 모자라요",
        하네스: r.harnessId,
        에이전트: r.agentId,
        실행: `${r.runs}번`,
        합격률: percent(r.passRate),
        점수: r.score ? `${r.score.mean.toFixed(1)}점` : null,
      })),
    })),
  };
}

/** 설정 화면: 이 브라우저의 화면 설정. */
export function settingsState(values: Readonly<Record<string, string>>) {
  return { 화면: "설정", 화면_설정: values };
}

/** 설정의 모델 구역: 서버에 등록한 모델(키는 없어요). */
export function modelsState(models: readonly LlmModelView[]) {
  return {
    등록한_모델: models.map((m) => ({
      이름: m.name,
      종류: m.kind,
      기본: m.isDefault,
      마지막_확인: m.lastCheck
        ? m.lastCheck.ok
          ? `연결됨 · ${m.lastCheck.ms}ms`
          : "연결 안 됨"
        : "아직 안 했어요",
    })),
  };
}

/** 새 세계 화면: 지금 어느 단계이고 어떤 모양을 골랐는지. */
export function shapeState(spec: ShapeSpec, step: string, problem: string | undefined) {
  return {
    화면: "새 세계",
    단계: step,
    이름: spec.name,
    서비스: spec.services.map((s) => s.name),
    서버: spec.servers ?? "알아서",
    막힌_이유: problem ?? null,
  };
}

export interface DraftNames {
  readonly world?: string;
  readonly scenario?: string;
  readonly harness?: string;
  readonly agent?: string;
}

/** 실험 만들기 화면에 지금 채워진 조건과 아직 빈 것. */
export function draftState(d: experiment.Draft, names: DraftNames, remaining: readonly string[]) {
  return {
    화면: "실험 만들기",
    세계: names.world ?? null,
    시나리오: names.scenario ?? null,
    하네스: names.harness ?? null,
    에이전트: names.agent ?? null,
    툴: `${d.tools.length}개`,
    횟수: `${d.runs}번`,
    아직_비어_있는_것: remaining,
  };
}

/** 글 속의 낱말이 가장 많이 이름에 들어 있는 것 하나. 하나도 안 맞으면 undefined. */
export function pickByText<T>(
  text: string,
  items: readonly T[],
  nameOf: (item: T) => string,
): T | undefined {
  const t = text.toLowerCase();
  let best: { item: T; hits: number } | undefined;
  for (const item of items) {
    const name = nameOf(item).toLowerCase();
    const words = name.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
    const hits =
      (t.includes(name) ? words.length + 1 : 0) + words.filter((w) => t.includes(w)).length;
    if (hits > (best?.hits ?? 0)) best = { item, hits };
  }
  return best?.item;
}
