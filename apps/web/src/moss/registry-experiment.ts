/** 이끼의 화면 등록부 — 실험과 실행(REQ-103). */
import type { PageName } from "../logic";
import { trio } from "./registry-kit";
import type { ScreenSpec } from "./types";

export const EXPERIMENT_SCREENS = {
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
        label: "몇 번 돌릴지 정하기",
        kind: "navigate",
        aliases: ["몇 번", "횟수"],
        saying: "몇 번 돌릴지 정할게요",
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
    oneLine:
      "한 실험의 요약(잘했나, 어디서 점수를 잃었나, 상황마다)을 보고, 실행·업무 비교·세계 범위 탭을 열고, 내보내거나 조건을 바꿔 다시 돌려요.",
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
        id: "exp-tab",
        label: "결과 탭 열기",
        kind: "navigate",
        aliases: [
          "실행 탭",
          "업무 비교 탭",
          "세계 범위 탭",
          "요약 탭",
          "업무 비교 보기",
          "세계 범위 보기",
        ],
        saying: "그 탭을 열게요",
      },
      {
        id: "exp-export",
        label: "내보내기",
        kind: "navigate",
        aliases: ["내보내", "보고서 내려받기", "보고서 받아"],
        saying: "내보내기를 열게요",
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
} satisfies Partial<Record<PageName, ScreenSpec>>;
