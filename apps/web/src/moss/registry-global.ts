/** 이끼의 화면 등록부 — 어느 화면에서나 쓰는 동작: 다른 화면으로 가기, 그리고 실험 하나 만들기 (REQ-103). */
import type { ActionSpec } from "./types";

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
  nav("go-operation-guide", "운영 모드 안내 열기", { name: "operationGuide" }, [
    "운영 모드",
    "운영 모드 안내",
  ]),
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
