/** 이끼의 화면 등록부 — 시나리오와 "지금 하는 방식"(REQ-103, REQ-112). */
import type { PageName } from "../logic";
import { trio } from "./registry-kit";
import type { ScreenSpec } from "./types";

export const SCENARIO_SCREENS = {
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
    actions: [
      {
        id: "process-add-step",
        label: "단계 한 줄 더하기",
        kind: "change",
        aliases: ["단계 추가", "한 줄 더"],
        confirm: "표에 빈 단계를 한 줄 더해요. 저장하기 전까지는 서버에 남지 않아요.",
      },
      {
        id: "process-save",
        label: "지금 하는 방식 저장",
        kind: "change",
        aliases: ["저장해"],
        confirm: "적은 표를 저장해요. {요약}",
      },
      {
        id: "process-experiment",
        label: "이 시나리오로 실험 만들기",
        kind: "navigate",
        aliases: ["다음으로 실험"],
      },
    ],
  },
} satisfies Partial<Record<PageName, ScreenSpec>>;
