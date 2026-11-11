/**
 * 이끼의 화면 등록부 (REQ-103, ADR-0124): 라우트마다 한 칸. 이름·한 줄 설명·처음 질문 셋·동작이 여기 있고 화면 컴포넌트는
 * `useMossScreen`으로 읽기와 핸들러를 붙인다. 순수한 데이터라 `moss` 검사가 읽고, 칸이 없는 라우트는 MOSS001이 막는다.
 */
import type { PageName } from "../logic";
import type { ActionSpec, ScreenSpec } from "./types";

const nav = (
  id: string,
  label: string,
  go: ActionSpec["go"],
  aliases: readonly string[],
  saying?: string,
): ActionSpec => ({
  id,
  label,
  kind: "navigate",
  go,
  aliases,
  ...(saying ? { saying } : {}),
});

/** 어느 화면에서나 쓸 수 있는 동작: 다른 화면으로 가기, 그리고 실험 하나 만들기. */
export const GLOBAL_ACTIONS: readonly ActionSpec[] = [
  nav("go-home", "홈으로 가기", { name: "home" }, ["홈", "처음 화면"]),
  nav("go-worlds", "세계 목록 열기", { name: "worlds" }, ["세계 목록", "세계들", "세계 보기"]),
  nav("go-scenarios", "시나리오 목록 열기", { name: "scenarios" }, ["시나리오 목록", "시나리오들"]),
  nav("go-experiments", "실험 목록 열기", { name: "experiments" }, [
    "실험 목록",
    "실험들",
    "실험 보기",
  ]),
  nav("go-benchmarks", "벤치마크 열기", { name: "benchmarks" }, ["벤치마크", "순위표"]),
  nav("go-connections", "연결 열기", { name: "connections" }, ["연결 목록", "하네스 연결"]),
  nav("go-operation-guide", "운영 모드 안내 열기", { name: "operationGuide" }, ["운영 모드"]),
  nav("go-settings", "설정 열기", { name: "settings" }, ["설정", "환경설정"]),
  nav("go-new-world", "새 세계 만들기", { name: "newWorld" }, ["새 세계", "세계 만들"]),
  nav("go-new-experiment", "새 실험 화면 열기", { name: "newExperiment" }, ["새 실험"]),
  {
    id: "make-experiment",
    label: "실험 만들기",
    kind: "change",
    aliases: ["실험 만들", "실험 하나", "실험 시작", "실험 돌려"],
    saying: "실험을 같이 만들게요",
    steps: [
      "go-new-experiment",
      "exp-pick-world",
      "exp-pick-scenario",
      "exp-pick-tools",
      "exp-set-runs",
      "exp-start",
    ],
  },
];

const trio = (a: string, b: string, c: string): [string, string, string] => [a, b, c];

export const SCREENS: Readonly<Record<PageName, ScreenSpec>> = {
  home: {
    route: "home",
    title: "홈",
    oneLine: "처음이면 세 단계로 시작하고, 인기 세계와 최근 실험을 한눈에 봐요.",
    stateLabel: "홈 화면의 지금 모습",
    questions: trio(
      "테라리움은 뭐 하는 곳이에요?",
      "처음에 뭐부터 하면 돼요?",
      "세계와 시나리오는 어떻게 달라요?",
    ),
    actions: [],
  },
  worlds: {
    route: "worlds",
    title: "세계 목록",
    oneLine: "에이전트가 일할 데이터센터를 인기 순서로 보고, 새로 만들거나 열어요.",
    stateLabel: "이 목록의 세계들",
    questions: trio(
      "세계는 어떤 순서로 보여요?",
      "인기 점수는 어떻게 세요?",
      "어떤 세계로 시작하면 좋아요?",
    ),
    actions: [
      {
        id: "worlds-sort",
        label: "세계 순서 바꾸기",
        kind: "navigate",
        aliases: ["순서 바꿔", "정렬"],
      },
    ],
  },
  world: {
    route: "world",
    title: "세계 짓기",
    oneLine: "3D로 방과 랙, 서버를 놓으며 세계를 지어요.",
    stateLabel: "이 세계의 현재 모양",
    questions: trio(
      "랙은 어떻게 놓아요?",
      "서버는 어디서 더해요?",
      "이 세계로 실험을 어떻게 만들어요?",
    ),
    actions: [
      {
        id: "world-make-scenario",
        label: "이 세계의 시나리오 보기",
        kind: "navigate",
        go: (a) => ({ name: "scenarios", ...(a.id ? { worldId: String(a.id) } : {}) }),
        aliases: ["시나리오 보기"],
      },
      {
        id: "world-make-experiment",
        label: "이 세계로 실험 만들기",
        kind: "navigate",
        go: (a) => ({ name: "newExperiment", ...(a.id ? { worldId: String(a.id) } : {}) }),
        aliases: ["이 세계로 실험"],
      },
      { id: "builder-rotate", label: "돌리기", kind: "change", confirm: "90도 돌려요." },
      { id: "builder-auto-wire", label: "자동 배선", kind: "change", confirm: "케이블을 이어요." },
      { id: "builder-add-server", label: "서버 넣기", kind: "read" },
      { id: "builder-trial", label: "시운전 하기", kind: "read" },
    ],
  },
  newWorld: {
    route: "newWorld",
    title: "새 세계",
    oneLine: "서비스부터 정하거나 직접 지어서 세계를 만들어요. 층마다 사다리에서 모양을 골라요.",
    stateLabel: "지금 고른 세계 모양",
    questions: trio(
      "사다리가 뭐예요?",
      "'알아서'는 어떻게 골라요?",
      "서비스부터와 직접 짓기는 뭐가 달라요?",
    ),
    actions: [
      {
        id: "world-ladders",
        label: "사다리로 가기",
        kind: "navigate",
        aliases: ["사다리", "층 고르기"],
        saying: "사다리로 갈게요",
      },
      {
        id: "world-build",
        label: "세계 만들기",
        kind: "change",
        aliases: ["세계 만들어"],
        confirm: "이 모양으로 세계를 만들어요. {요약}",
      },
      {
        id: "world-quick-start",
        label: "실험 시작",
        kind: "change",
        aliases: ["바로 실험", "실험 시작해"],
        confirm: "세계를 짓고 권장 설정(5번, 기본 툴)으로 실험을 시작해요. {요약}",
      },
      {
        id: "ladder-preset-auto",
        label: "알아서 고르기",
        kind: "change",
        confirm: "알아서 골라요.",
      },
      { id: "ladder-preset-cheap", label: "싸게 고르기", kind: "change", confirm: "싸게 골라요." },
      {
        id: "ladder-preset-middle",
        label: "보통으로 고르기",
        kind: "change",
        confirm: "보통으로 골라요.",
      },
      {
        id: "ladder-preset-steady",
        label: "멈추지 않게 고르기",
        kind: "change",
        confirm: "안 멈추게 골라요.",
      },
      {
        id: "ladder-fix-needs",
        label: "받치는 층도 바꾸기",
        kind: "change",
        confirm: "받치는 층도 올려요.",
      },
    ],
  },
  scenarios: {
    route: "scenarios",
    title: "시나리오 목록",
    oneLine: "에이전트에게 낼 문제(고장과 정답)를 세계마다 골라 보고 새로 만들어요.",
    stateLabel: "이 목록의 시나리오들",
    questions: trio(
      "시나리오는 뭐예요?",
      "시험 가동은 뭐 하는 거예요?",
      "새 시나리오는 어떻게 만들어요?",
    ),
    actions: [],
  },
  scenario: {
    route: "scenario",
    title: "시나리오 편집",
    oneLine: "고장이 어떻게 일어나고 무엇이 정답인지 흐름으로 짜요.",
    stateLabel: "이 시나리오의 내용",
    questions: trio(
      "조건은 어떻게 붙여요?",
      "변별력 점검은 뭐예요?",
      "이 시나리오로 실험을 만들려면요?",
    ),
    actions: [
      {
        id: "scenario-make-experiment",
        label: "이 시나리오로 실험 만들기",
        kind: "navigate",
        go: (a) => ({ name: "newExperiment", ...(a.id ? { scenarioId: String(a.id) } : {}) }),
        aliases: ["이 시나리오로 실험"],
      },
    ],
  },
  scenarioProcess: {
    route: "scenarioProcess",
    title: "지금 하는 방식",
    oneLine: "사람이 지금 누가 뭘 하는지 단계로 적어요. 결과에서 에이전트와 나란히 놓여요.",
    stateLabel: "적고 있는 표",
    questions: trio("적은 값은 어디에 쓰여요?", "사람 수는 어떻게 세요?", "종류는 뭐가 있어요?"),
    actions: [],
  },
  experiments: {
    route: "experiments",
    title: "실험 목록",
    oneLine: "모두의 실험과 내 실험을 상태별로 보고, 하나를 열거나 새로 만들어요.",
    stateLabel: "이 목록의 실험들",
    questions: trio("실험은 뭐예요?", "상태는 어떤 것들이 있어요?", "내 실험만 보려면요?"),
    actions: [
      {
        id: "experiments-mine",
        label: "내 실험만 보기",
        kind: "navigate",
        go: { name: "experiments", mine: true },
        aliases: ["내 실험"],
      },
    ],
  },
  newExperiment: {
    route: "newExperiment",
    title: "실험 만들기",
    oneLine: "세계와 시나리오, 하네스와 에이전트, 툴을 정하고 실험을 시작해요.",
    stateLabel: "지금 채운 실험 조건",
    questions: trio(
      "몇 번 돌리는 게 좋아요?",
      "툴은 어떻게 골라요?",
      "시나리오는 어떤 걸 고르면 돼요?",
    ),
    actions: [
      {
        id: "exp-pick-world",
        label: "세계 고르기",
        kind: "navigate",
        aliases: ["세계 골라"],
        saying: "세계를 고를게요",
      },
      {
        id: "exp-pick-scenario",
        label: "시나리오 고르기",
        kind: "navigate",
        aliases: ["시나리오 골라"],
        saying: "시나리오를 고를게요",
      },
      {
        id: "exp-pick-tools",
        label: "툴 묶음 고르기",
        kind: "navigate",
        aliases: ["툴 골라", "도구 골라"],
        saying: "툴은 기본 묶음으로 둘게요",
      },
      {
        id: "exp-set-runs",
        label: "돌릴 횟수 정하기",
        kind: "navigate",
        aliases: ["몇 번", "횟수"],
        saying: "돌릴 횟수를 정할게요",
      },
      {
        id: "exp-start",
        label: "실험 시작",
        kind: "change",
        aliases: ["시작해"],
        confirm: "이 조건으로 실험을 시작해요. {요약}",
      },
    ],
  },
  experiment: {
    route: "experiment",
    title: "실험 결과",
    oneLine: "한 실험의 요약, 실행별 점수와 합격, 조건을 보고 다시 돌려요.",
    stateLabel: "이 실험의 결과와 조건",
    questions: trio(
      "합격은 어떻게 정해져요?",
      "점수 차이가 믿을 만한가요?",
      "조건을 바꿔 다시 돌리려면요?",
    ),
    actions: [
      {
        id: "exp-open-run",
        label: "실행 열기",
        kind: "navigate",
        aliases: ["실행 열어"],
        saying: "그 실행을 열게요",
      },
      {
        id: "exp-fork",
        label: "조건 바꿔 다시 돌리기",
        kind: "navigate",
        go: (a) => ({ name: "newExperiment", ...(a.id ? { forkOf: String(a.id) } : {}) }),
        aliases: ["다시 돌려", "조건 바꿔"],
      },
      {
        id: "exp-cancel",
        label: "실험 멈추기",
        kind: "change",
        aliases: ["멈춰", "취소해"],
        confirm: "돌고 있는 이 실험을 멈춰요. {요약}",
      },
    ],
  },
  run: {
    route: "run",
    title: "결과 화면",
    oneLine: "한 번의 실행에서 무슨 일이 있었고, 에이전트가 뭘 했고, 어떻게 채점됐는지 봐요.",
    stateLabel: "이 실행의 사건 기록",
    questions: trio(
      "이 실행이 왜 이 점수예요?",
      "합격 기준이 뭐예요?",
      "에이전트가 처음에 뭘 했어요?",
    ),
    actions: [
      {
        id: "run-open-experiment",
        label: "이 실험으로 가기",
        kind: "navigate",
        aliases: ["실험으로"],
      },
      {
        id: "run-show-tab",
        label: "기록 탭 열기",
        kind: "navigate",
        aliases: ["툴 호출 보기", "지표 보기", "일어난 일 보기"],
      },
      {
        id: "run-read-scores",
        label: "점수표 읽어 주기",
        kind: "read",
        aliases: ["점수표", "점수 읽어"],
      },
    ],
  },
  benchmarks: {
    route: "benchmarks",
    title: "벤치마크",
    oneLine: "같은 과제를 푼 에이전트들의 순위와 점수를 비교해요.",
    stateLabel: "이 순위표",
    questions: trio("순위는 어떻게 매겨요?", "같은 세트가 뭐예요?", "내 에이전트를 올리려면요?"),
    actions: [],
  },
  connections: {
    route: "connections",
    title: "연결",
    oneLine: "실험할 하네스와 에이전트를 연결하고 상태를 확인해요.",
    stateLabel: "연결된 하네스들",
    questions: trio("하네스를 어떻게 연결해요?", "말 걸어 보기는 뭐예요?", "연결이 왜 사라졌어요?"),
    actions: [
      {
        id: "connections-add",
        label: "연결 더하기",
        kind: "navigate",
        aliases: ["연결 추가", "연결 만들"],
        saying: "연결 창을 열게요",
      },
    ],
  },
  settings: {
    route: "settings",
    title: "설정",
    oneLine: "화면 설정은 이 브라우저에, 모델은 서버에 저장해요.",
    stateLabel: "설정과 등록한 모델",
    questions: trio(
      "모델은 어떻게 등록해요?",
      "이끼는 어떤 모델을 써요?",
      "화면 색은 어디서 바꿔요?",
    ),
    actions: [
      {
        id: "settings-theme",
        label: "화면 색 바꾸기",
        kind: "navigate",
        aliases: ["다크 모드", "라이트 모드", "화면 색"],
      },
      {
        id: "models-add",
        label: "모델 더하기",
        kind: "navigate",
        aliases: ["모델 등록", "모델 추가"],
        saying: "모델 등록 창을 열게요",
      },
      {
        id: "check-model",
        label: "모델 연결 확인",
        kind: "change",
        aliases: ["연결 확인"],
        confirm: "등록한 모델에 짧게 말을 걸어 연결을 확인해요. {요약}",
      },
      {
        id: "set-default-model",
        label: "기본 모델로 정하기",
        kind: "change",
        aliases: ["기본으로"],
        confirm: "이 모델을 기본 모델로 정해요. 이끼도 이 모델을 써요. {요약}",
      },
    ],
  },
  operationGuide: {
    route: "operationGuide",
    title: "운영 모드 안내",
    oneLine: "8시간을 지켜보는 운영 에이전트를 만드는 법을 안내해요.",
    stateLabel: "이 안내 문서",
    questions: trio(
      "운영 모드는 뭐예요?",
      "운영 에이전트는 무엇을 지켜봐요?",
      "실험으로는 어떻게 돌려요?",
    ),
    actions: [
      {
        id: "guide-open-connections",
        label: "연결 화면으로 가기",
        kind: "navigate",
        go: { name: "connections" },
        aliases: ["연결로"],
      },
    ],
  },
  agentVersions: {
    route: "agentVersions",
    title: "에이전트 버전",
    oneLine: "에이전트의 버전 목록과 바뀐 점을 보고, 직접 버전을 적어 둬요.",
    stateLabel: "이 에이전트의 버전들",
    questions: trio(
      "버전은 왜 기록해요?",
      "버전을 직접 더하려면요?",
      "실험에 버전이 어떻게 붙어요?",
    ),
    actions: [
      {
        id: "versions-back",
        label: "연결 화면으로 돌아가기",
        kind: "navigate",
        go: { name: "connections" },
        aliases: ["돌아가"],
      },
    ],
  },
  notFound: {
    route: "notFound",
    title: "없는 화면",
    oneLine: "주소에 해당하는 화면이 없어요.",
    stateLabel: "이 주소",
    questions: trio("왜 화면이 없어요?", "어디로 가면 돼요?", "처음 화면은 어디예요?"),
    actions: [],
  },
};

export const SCREEN_LIST: readonly ScreenSpec[] = Object.values(SCREENS);

/** 한 화면에서 쓸 수 있는 동작: 그 화면 것 먼저, 그다음 어디서나 쓰는 것. */
export function actionsOf(route: PageName): readonly ActionSpec[] {
  const own = SCREENS[route].actions;
  return [...own, ...GLOBAL_ACTIONS.filter((g) => !own.some((o) => o.id === g.id))];
}

/** 어느 화면에 있든 등록된 모든 동작. */
export const ALL_ACTIONS: readonly ActionSpec[] = [
  ...GLOBAL_ACTIONS,
  ...SCREEN_LIST.flatMap((s) => s.actions),
];

/** 아이디는 등록부 전체에서 하나라서, 어느 화면 것인지 몰라도 찾아요(여러 단계 일이 화면을 넘나들 때). */
export function actionById(id: string): ActionSpec | undefined {
  return ALL_ACTIONS.find((a) => a.id === id);
}

export function findAction(route: PageName, id: string): ActionSpec | undefined {
  return actionsOf(route).find((a) => a.id === id);
}

/** 검사기가 JSON으로 읽어 가는 모양 (`harness/src/checks/moss.ts`). */
const dumped = (a: ActionSpec) => ({ id: a.id, kind: a.kind, static: Boolean(a.go || a.steps) });

export function registryDump() {
  return {
    screens: SCREEN_LIST.map((s) => ({
      route: s.route,
      title: s.title,
      oneLine: s.oneLine,
      questions: s.questions,
      actions: s.actions.map(dumped),
    })),
    global: GLOBAL_ACTIONS.map(dumped),
  };
}
