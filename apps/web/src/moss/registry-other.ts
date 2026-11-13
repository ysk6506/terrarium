/** 이끼의 화면 등록부 — 벤치마크·연결·설정·안내·없는 주소(REQ-103). */
import type { PageName } from "../logic";
import { trio } from "./registry-kit";
import type { ScreenSpec } from "./types";

export const OTHER_SCREENS = {
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
  audit: {
    route: "audit",
    title: "감사 기록",
    oneLine: "누가 무엇을 했는지, 무엇이 막혔는지 읽어요. 고치거나 지울 수 없어요.",
    stateLabel: "이 기록 목록",
    questions: trio(
      "감사 기록에는 무엇이 남아요?",
      "막혔다는 건 무슨 뜻이에요?",
      "기록을 파일로 받으려면요?",
    ),
    actions: [],
  },
  notFound: {
    route: "notFound",
    title: "없는 화면",
    oneLine: "주소에 해당하는 화면이 없어요.",
    stateLabel: "이 주소",
    questions: trio("왜 화면이 없어요?", "어디로 가면 돼요?", "처음 화면은 어디예요?"),
    actions: [],
  },
} satisfies Partial<Record<PageName, ScreenSpec>>;
