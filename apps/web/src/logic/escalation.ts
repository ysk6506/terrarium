/**
 * Asking a person for help (REQ-081, ADR-0087 item 4) and following a runbook (REQ-082, item 6), as the screens
 * say them: what a person can do for a waiting agent, the figures of a result, and the runbook block. All pure
 * text from the result, so a test can read it.
 */
import type { EscalationCard } from "@terrarium/core/contract";
import { ESCALATION_LABELS, type HumanSummary, type SopResult } from "@terrarium/core/session";
import type { Blueprint, EntityKind } from "@terrarium/core/world";
import { formatDuration, relativeTime } from "./format";
import type { Figure } from "./recovery";
import { titleOf } from "./tool-picker";

// ── what a person can do ───────────────────────────────────────────────────────────────────

export interface HumanAction {
  readonly id: string;
  readonly label: string;
  /** The tool that does it: the person has the hands the agent has. */
  readonly tool: string;
  readonly targets: readonly EntityKind[];
  /** A number to give with it (a setpoint). */
  readonly value?: {
    readonly label: string;
    readonly unit: string;
    readonly start: number;
    readonly min: number;
    readonly max: number;
  };
  readonly args: (target: string, value: number) => Record<string, unknown>;
}

export const HUMAN_ACTIONS: readonly HumanAction[] = [
  {
    id: "server-on",
    label: "서버 전원 켜기",
    tool: "power_server",
    targets: ["server"],
    args: (id) => ({ id, action: "on" }),
  },
  {
    id: "server-off",
    label: "서버 전원 끄기",
    tool: "power_server",
    targets: ["server"],
    args: (id) => ({ id, action: "off" }),
  },
  {
    id: "breaker",
    label: "차단기 리셋",
    tool: "reset_breaker",
    targets: ["pdu", "power_panel"],
    args: (id) => ({ id }),
  },
  {
    id: "cooling-restart",
    label: "냉방기 다시 시작",
    tool: "restart_cooling_unit",
    targets: ["cooling_unit"],
    args: (unitId) => ({ unitId }),
  },
  {
    id: "setpoint",
    label: "냉방 설정 온도 바꾸기",
    tool: "set_cooling_setpoint",
    targets: ["cooling_unit"],
    value: { label: "설정 온도", unit: "°C", start: 18, min: 10, max: 30 },
    args: (unitId, celsius) => ({ unitId, celsius }),
  },
  {
    id: "failover",
    label: "서비스를 대기 쪽으로 옮기기",
    tool: "failover_service",
    targets: ["service"],
    args: (service) => ({ service }),
  },
  {
    id: "service-restart",
    label: "서비스 다시 시작",
    tool: "restart_service",
    targets: ["service"],
    args: (service) => ({ service }),
  },
];

/** What the action can be done to in this world, by name. */
export function targetsOf(
  action: HumanAction,
  blueprint: Blueprint | undefined,
): { readonly id: string; readonly name: string }[] {
  return (blueprint?.entities ?? [])
    .filter((e) => action.targets.includes(e.kind))
    .map((e) => ({ id: e.id, name: e.name }));
}

// ── the card ───────────────────────────────────────────────────────────────────────────────

export const CARD_WORDS = {
  TITLE: "사람을 기다리는 중이에요",
  ASKED: "에이전트가 한 말",
  RECENT: "최근 툴 호출 5개",
  NO_CALLS: "아직 부른 툴이 없어요",
  STILL: "세계의 시간도 멈춰 있어요",
  REPLY: "답만 하기",
  ACT: "대신 조치하기",
  MORE: "툴 더 주고 계속",
  END: "실행 끝내기",
  REPLY_LABEL: "에이전트에게 보낼 답",
  REPLY_SEND: "답 보내기",
  ACT_DO: "하기",
  ACT_DONE: "조치 끝, 에이전트에게 돌려주기",
  ACT_NONE: "아직 한 조치가 없어요. 하나도 안 하고 돌려줘도 돼요",
  MORE_SEND: (n: number) => `${n}개 주고 계속하기`,
  MORE_NONE: "줄 툴을 골라 주세요",
  END_ASK: "정말 끝낼까요? 지금까지의 실행이 '사람에게 넘기다 끝남'으로 채점돼요",
} as const;

/** "3분 전부터 기다려요", in whole units. */
export function waitingSince(card: EscalationCard, nowMs: number): string {
  return `${relativeTime(card.since, nowMs)}부터 기다려요`;
}

/** The tool as a person reads it, with how it went. */
export function recentLine(call: EscalationCard["request"]["recent"][number]): string {
  const result = call.ok ? "" : " — 실패";
  const what = call.summary ? `: ${call.summary}` : "";
  return `${titleOf(call.tool)}${what}${result}`;
}

// ── the figures of a result ────────────────────────────────────────────────────────────────

/** Escalation on a result, apart from the score: how often, how long a person kept it waiting, what they did. */
export function escalationFigures(human: HumanSummary | undefined): readonly Figure[] {
  if (!human) return [];
  const acts = human.acts.length;
  return [
    {
      label: "넘긴 일",
      value: `${human.count}번`,
      hint: `처리 방식: ${ESCALATION_LABELS[human.mode]}`,
    },
    {
      label: "기다린 시간",
      value: human.waitedSeconds === 0 ? "0초" : formatDuration(Math.round(human.waitedSeconds)),
      hint: "사람이 답하기까지 걸린 실제 시간이에요. 세계의 시간은 가지 않았어요",
    },
    {
      label: "사람이 한 조치",
      value: `${acts}개`,
      hint:
        acts === 0 ? "사람이 세계를 바꾼 것이 없어요" : human.acts.map((a) => a.summary).join(", "),
    },
  ];
}

// ── the runbook block of a result ──────────────────────────────────────────────────────────

export const SOP_MODE_LABELS = { none: "안 줌", given: "줌", search: "찾게 함" } as const;

/** Runbook compliance on a result: three numbers, apart from the recovery-first score. */
export function sopFigures(sop: SopResult | undefined): readonly Figure[] {
  if (!sop) return [];
  return [
    {
      label: "절차서 준수",
      value: `${sop.compliancePct}%`,
      hint: `절차서 '${sop.title}'를 ${SOP_MODE_LABELS[sop.mode]}으로 돌렸어요. 점수에는 섞이지 않아요`,
    },
    {
      label: "단계 수행",
      value: `${sop.done}/${sop.scored}단계`,
      hint: "단계에 적힌 툴을 한 번이라도 성공적으로 부른 단계예요",
    },
    {
      label: "순서",
      value: `${sop.orderPct}%`,
      hint: "수행한 단계 가운데 절차서 순서대로 한 비율이에요",
    },
    {
      label: "건너뜀",
      value: `${sop.skipped.length}단계`,
      hint:
        sop.skipped.length === 0
          ? "건너뛴 단계가 없어요"
          : `건너뛴 단계: ${sop.skipped.map((id) => `${id.slice(1)}번`).join(", ")}`,
    },
  ];
}

export type StepState = "done" | "late" | "skipped" | "thought";

/** How one step of the runbook went, for the list under the figures. */
export function stepState(step: SopResult["steps"][number]): StepState {
  if (!step.scored) return "thought";
  if (!step.done) return "skipped";
  return step.inOrder ? "done" : "late";
}

export const STEP_LABELS: Readonly<Record<StepState, string>> = {
  done: "했어요",
  late: "순서가 달랐어요",
  skipped: "건너뛰었어요",
  thought: "툴이 없는 단계예요",
};
