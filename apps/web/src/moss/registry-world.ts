/** 이끼의 화면 등록부 — 홈과 세계(REQ-103). */
import type { PageName } from "../logic";
import { trio } from "./registry-kit";
import type { ScreenSpec } from "./types";

export const WORLD_SCREENS = {
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
} satisfies Partial<Record<PageName, ScreenSpec>>;
