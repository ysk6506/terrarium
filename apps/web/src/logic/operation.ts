/**
 * What the screens say about an operation (REQ-090, ADR-0094): the form's choices, the recommended instruction with its
 * reasons, the notes for each kind of connection, the numbers of a result and the mid-run card. Pure text and arithmetic
 * from the config and the run's events, so a test can read every sentence.
 */
import {
  DEFAULT_OPERATION,
  FAST_SPEED_MAX,
  FAST_SPEED_MIN,
  type OperationConfig,
  type OperationMetrics,
  type OperationPreset,
  operationMetrics,
  PRESET_LABELS,
  paceLabel,
} from "@terrarium/core/session";
import type { Incident, RunEvent } from "@terrarium/core/world";
import { incidents } from "@terrarium/core/world";
import { formatDuration, percent } from "./format";

export { DEFAULT_OPERATION, FAST_SPEED_MAX, FAST_SPEED_MIN, PRESET_LABELS, paceLabel };

/** The lengths the form offers first; any whole number of hours up to 96 can be typed. */
export const HOUR_CHOICES: readonly number[] = [8, 24, 48];

export const PRESETS: readonly { id: OperationPreset; label: string; hint: string }[] = [
  { id: "quiet", label: PRESET_LABELS.quiet, hint: "고장이 드물어요. 평소의 약 3분의 1이에요" },
  { id: "normal", label: PRESET_LABELS.normal, hint: "장비 고장률 표 그대로예요" },
  { id: "busy", label: PRESET_LABELS.busy, hint: "고장이 잦아요. 평소의 3배예요" },
];

export const PACE_TEXT = {
  realtime: {
    label: "실시간",
    hint: "세계의 시간이 실제 시간과 같이 흘러요. 공식 점수는 이 방식만 인정해요",
  },
  fast: {
    label: "빨리 감기",
    hint: "조용할 때만 빨라져요. 알람이 나거나 담당자가 움직인 뒤 5분, 툴을 부르는 동안에는 실제 속도예요. 결과에 '빨리 감기'라고 표시돼요",
  },
} as const;

/** Why the "알람마다 깨우기" switch is grey, or nothing when it can be turned on. */
export function wakeReason(wakeable: boolean | undefined): string | undefined {
  return wakeable
    ? undefined
    : "이 연결은 알람 요약을 밀어 받을 수 없어요. 끄고 돌리면 에이전트가 직접 확인해요";
}

export const WAKE_HINT =
  "켜면 알람이 올라올 때마다 하네스에 요약을 보내요. 끄면 세계는 아무것도 보내 주지 않고, 에이전트가 스스로 확인해야 해요. 둘의 결과를 비교하는 실험 변수예요";

/** One line of the recommended instruction and why it is there. */
export interface InstructionLine {
  readonly text: string;
  readonly why: string;
}

export const RECOMMENDED_LINES: readonly InstructionLine[] = [
  {
    text: "5분마다 events_since로 새 알람과 담당자 소식을 확인하세요.",
    why: "세계는 알람을 밀어 주지 않아요. 안 보면 놓친 알람이 쌓이고, 너무 자주 보면 비용이 늘어요. 5분이 균형점이에요.",
  },
  {
    text: "문제가 생기면 원인 분석보다 서비스 복구를 먼저 하세요.",
    why: "점수는 서비스가 멈춘 시간으로 매겨요. 원인은 서비스를 살린 뒤에 찾아도 늦지 않아요.",
  },
  {
    text: "조치하기 전에 영향받는 서비스를 먼저 확인하세요.",
    why: "멀쩡하던 서비스를 멈추게 하면 '악화'로 세요. 되돌릴 수 있는 조치부터 하세요.",
  },
  {
    text: "직접 못 고치면 ask_human이나 escalate로 넘기고, 끝난 뒤 임시로 옮겨 둔 것을 되돌리세요.",
    why: "내 도메인 밖의 고장은 맡은 팀이 몇 시간 뒤에 고쳐요. 그동안 서비스를 살려 두고, 끝나면 원래대로 돌려 놓아야 해요.",
  },
  {
    text: "조용하면 wait로 기다리세요.",
    why: "할 일이 없을 때 조회를 반복하면 비용만 들어요. 조용할 때 쓴 호출 수도 측정해요.",
  },
];

export const recommendedInstruction = (): string => RECOMMENDED_LINES.map((l) => l.text).join("\n");

/** Notes for the instruction, by the kind of connection the agent runs on. */
export function harnessNotes(kind: string | undefined): readonly string[] {
  switch (kind) {
    case "scripted":
      return ["내장 에이전트 'operator'는 이 지시문을 읽지 않고 정해진 5분 주기로 움직여요."];
    case "http":
    case "a2a":
      return [
        "한 번 요청으로 끝나는 하네스는 운영 시간 내내 붙어 있지 못할 수 있어요. 요청 한 번이 몇 시간 이어져도 되는지 확인해 주세요.",
      ];
    case "goclaw":
    case "hermes":
      return [
        "하네스가 에이전트를 몇 시간씩 깨워 둘 수 있는지, 그리고 대화 길이 제한이 있는지 확인해 주세요. 가이드의 상주 루프 예를 참고하세요.",
      ];
    case "mcp-agent":
      return [
        "툴 호출 사이에 하네스가 에이전트를 재울 수 있어요. wait 호출이 길어도 연결이 유지되는지 보세요.",
      ];
    default:
      return ["가이드의 '상주 루프 예'에서 이 하네스와 가장 비슷한 것을 골라 따라 하세요."];
  }
}

/** What the form says about a config it cannot run, or nothing. */
export { operationProblem } from "@terrarium/core/session";

// ── a result ───────────────────────────────────────────────────────────────────────────────

export interface OpFigure {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}

const seconds = (s: number | undefined) => (s === undefined ? "—" : formatDuration(Math.round(s)));

/** The three first numbers of an operation result: availability, missed alarms, detection delay. */
export function headlineFigures(m: OperationMetrics): OpFigure[] {
  return [
    {
      label: "서비스 가용률",
      value: m.availability === undefined ? "서비스 없음" : percent(m.availability, 2),
      hint: "멈춘 시간은 그대로, 느린 시간은 30%만 빼서 계산해요",
    },
    {
      label: "놓친 알람",
      value: `${m.missed}개`,
      hint: `올라온 알람 ${m.alarms}개 중 에이전트가 어떤 조회로도 보지 않은 것이에요`,
    },
    {
      label: "탐지 지연",
      value: seconds(m.detectionDelayS),
      hint:
        m.undetected > 0
          ? `고장이 난 뒤 처음 확인하기까지의 중앙값이에요. 끝까지 확인 못 한 사건 ${m.undetected}건은 끝까지로 쳤어요`
          : "고장이 난 뒤 에이전트가 처음 확인하기까지의 중앙값이에요",
    },
  ];
}

/** The rest, in the order of the decision. */
export function otherFigures(m: OperationMetrics): OpFigure[] {
  const r = m.recovery;
  return [
    {
      label: "사건별 복구 시간(중앙값)",
      value: seconds(r?.median),
      hint: r
        ? `최소 ${seconds(r.min)} · 최대 ${seconds(r.max)}예요. 사건 ${m.incidents}건 중 ${m.open}건은 끝까지 안 풀렸어요`
        : `끝난 사건이 없어요. 사건 ${m.incidents}건이 모두 끝까지 안 풀렸어요`,
    },
    {
      label: "악화",
      value: `${m.worsened}번`,
      hint: "조치 직후 멀쩡하던 서비스가 멈춘 횟수예요",
    },
    {
      label: "에스컬레이션",
      value: `${m.escalations}번`,
      hint: "escalate로 팀에 넘기거나 ask_human으로 사람에게 물은 횟수예요",
    },
    {
      label: "사건당 툴 호출",
      value: m.callsPerIncident === undefined ? "—" : `${m.callsPerIncident.toFixed(1)}회`,
      hint: `전체 ${m.calls}회를 사건 수로 나눈 값이에요`,
    },
    ...(m.tokensPerIncident === undefined
      ? []
      : [
          {
            label: "사건당 토큰",
            value: Math.round(m.tokensPerIncident).toLocaleString("ko-KR"),
            hint: "하네스가 알려 준 토큰을 사건 수로 나눈 값이에요",
          },
        ]),
    {
      label: "조용할 때 쓴 호출",
      value: `${m.quietCalls}회`,
      hint:
        m.quietTokens === undefined
          ? "알람이 없는 동안 부른 횟수예요"
          : `알람이 없는 동안 부른 횟수예요. 그때 쓴 토큰은 약 ${m.quietTokens.toLocaleString("ko-KR")}개로 어림해요`,
    },
    {
      label: "감시 주기",
      value: seconds(m.watchIntervalS),
      hint: "알람을 확인한 간격의 중앙값이에요. 짧을수록 빨리 알지만 비용이 늘어요",
    },
  ];
}

/** The measures of a finished or running operation, with the harness's tokens when it told them. */
export function metricsOf(
  events: readonly RunEvent[],
  harms: ReadonlyArray<{ id: string; perHourKrw?: number; delayHours?: number }>,
  tokens?: number,
): OperationMetrics {
  return operationMetrics({ events, harms, ...(tokens === undefined ? {} : { tokens }) });
}

/** How the run was paced, for the head of a result and a benchmark row. */
export function paceNote(config: OperationConfig): string {
  const official = config.pace.mode === "realtime";
  return `${config.hours}시간 운영 · ${paceLabel(config.pace)}${official ? " · 공식 점수" : " · 공식 점수 아님"}`;
}

// ── the card in the middle of a run ───────────────────────────────────────────────────────

export interface CheckCard {
  /** "14시간째". */
  readonly headline: string;
  readonly parts: readonly string[];
}

/** When the next team will be done, in world seconds, among the hand-offs not done yet. */
export function nextTeamDone(events: readonly RunEvent[], now: number): number | undefined {
  const done = new Set<string>();
  const due: number[] = [];
  for (const e of events) {
    if (e.kind !== "counterpart") continue;
    if (e.what === "done") done.add(`${e.handoff}:${e.fault.faultId}`);
    if (e.what === "handed")
      for (const f of e.faults)
        if (f.doneAt > now && !done.has(`${e.handoff}:${f.faultId}`)) due.push(f.doneAt);
  }
  return due.length === 0 ? undefined : Math.min(...due) - now;
}

/** "14시간째 · 열린 사건 1 · 놓친 알람 0 · 다음 담당자 완료 2시간 뒤". */
export function checkCard(events: readonly RunEvent[], hours: number): CheckCard {
  const start = events.find((e) => e.kind === "score" && e.what === "agent_start")?.t ?? 0;
  const now = events.reduce((t, e) => Math.max(t, e.t), start);
  const open: Incident[] = incidents(events).filter((i) => i.endT === undefined);
  const m = operationMetrics({ events, harms: [], endedAt: now });
  const next = nextTeamDone(events, now);
  const passed = Math.min(Math.floor((now - start) / 3600) + 1, Math.ceil(hours));
  return {
    headline: `${passed}시간째`,
    parts: [
      `열린 사건 ${open.length}`,
      `놓친 알람 ${m.missed}`,
      ...(next === undefined ? [] : [`다음 담당자 완료 ${formatDuration(Math.round(next))} 뒤`]),
    ],
  };
}

export const checkText = (c: CheckCard): string => [c.headline, ...c.parts].join(" · ");

/** The sentence under a run that stopped because of a limit, or nothing. */
export function limitNote(
  endReason: string | undefined,
  budget: OperationConfig["budget"],
): string | undefined {
  if (endReason !== "tool_budget") return undefined;
  const n = budget?.maxToolCalls;
  return n
    ? `툴 호출 ${n}회 상한에 닿아 멈췄어요. 상한은 실험 만들기에서 바꿀 수 있어요`
    : undefined;
}

/** "서버가 다시 시작돼 3분 뒤 이어 갔어요": once for each time the server stopped and the operation was picked up (ADR-0094 item 8). */
export function resumeNotes(events: readonly RunEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.kind !== "link" || e.what !== "resumed") return [];
    const s = e.gapSeconds ?? 0;
    const after =
      s < 60 ? `${Math.max(1, Math.round(s))}초` : formatDuration(Math.round(s / 60) * 60);
    return [
      `서버가 다시 시작돼 ${after} 뒤 이어 갔어요. 멈춰 있던 동안 세계 시간은 흐르지 않았어요`,
    ];
  });
}
