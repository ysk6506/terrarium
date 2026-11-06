/**
 * The score of a scenario with services: recovery first (REQ-088, ADR-0091 item 3, ADR-0104). Four axes, in the order
 * they matter:
 *
 *   time      35  how soon the services were well again, counted from the moment the agent had the task
 *   order     15  how soon the agent made the change that did it, whatever it still wanted to find out later
 *   worsen    20  a change that stops a service that was well takes 20 points for each; the 20 are earned by a recovery
 *                 that harmed nothing, so no change and no recovery means no points
 *   report    30  the diagnosis: 60% the cause, 40% the kind of fault (as every other sheet counts it)
 *
 * time + order + worsen are 70 of 100. Points for time and order are halved when the recovery does not last (the sheet
 * names a condition for that, for example "moved to the standby" for a leak a restart only pauses). A prohibition on
 * the sheet (rebooting the host) still takes its points. Only a recovery the agent brought about counts: a service
 * that came back by itself, or that never stopped, earns nothing here.
 */
import { formatDuration, round } from "@terrarium/core/kernel";
import type { RecoveryReport } from "./recovery";

export const RECOVERY_WEIGHTS = { time: 35, order: 15, worsen: 20, report: 30 } as const;

/** The agent's time to recovery: full points up to here, none from the next bound on, a straight line between. */
export const FULL_RECOVERY_S = 300;
export const ZERO_RECOVERY_S = 1200;
/** The time to the change that did it. */
export const FULL_ORDER_S = 120;
export const ZERO_ORDER_S = 600;
/** A recovery that does not last keeps this share of the points for time and order. */
export const NOT_LASTING_SHARE = 0.5;

/** One axis of the score, in the shape the sheet shows: the same fields as a score item of any other scoring. */
export interface RecoveryAxis {
  readonly id: "recovery_time" | "recovery_order" | "no_worsening";
  readonly label: string;
  readonly verdict: "pass" | "partial" | "fail" | "penalty";
  readonly points: number;
  readonly max: number;
  readonly detail: string;
}

/** 1 up to `full`, 0 from `zero` on, a straight line between. */
export function ramp(value: number, full: number, zero: number): number {
  if (value <= full) return 1;
  if (value >= zero) return 0;
  return (zero - value) / (zero - full);
}

const minutes = (s: number) => formatDuration(Math.round(s));

type Id = RecoveryAxis["id"];

/** An axis that earned nothing, and why. */
const nothing = (id: Id, label: string, max: number, detail: string): RecoveryAxis => ({
  id,
  label,
  verdict: "fail",
  points: 0,
  max,
  detail,
});

/** An axis that earned `points` of `max`. */
const earned = (
  id: Id,
  label: string,
  max: number,
  points: number,
  detail: string,
): RecoveryAxis => ({
  id,
  label,
  verdict: points >= max ? "pass" : points > 0 ? "partial" : "fail",
  points,
  max,
  detail,
});

function timeAxis(r: RecoveryReport, share: number): RecoveryAxis {
  const [id, label, max] = ["recovery_time", "서비스 복구 시간", RECOVERY_WEIGHTS.time] as const;
  if (r.impairedAt === undefined)
    return nothing(id, label, max, "서비스가 멈추거나 느려진 적이 없어서 잴 수 없어요");
  if (!r.recovered)
    return nothing(
      id,
      label,
      max,
      `끝날 때까지 복구하지 못했어요 (${minutes(r.agentSeconds)} 동안)`,
    );
  if (!r.byAgent)
    return nothing(id, label, max, "조치한 것이 없는데 저절로 돌아와서 점수가 없어요");
  const points = round(max * ramp(r.agentSeconds, FULL_RECOVERY_S, ZERO_RECOVERY_S) * share, 2);
  const lasts = share < 1 ? " — 복구가 오래 가지 않아서 절반만 인정해요" : "";
  const bounds = `${minutes(FULL_RECOVERY_S)} 안이면 만점, ${minutes(ZERO_RECOVERY_S)} 넘으면 0점`;
  return earned(
    id,
    label,
    max,
    points,
    `맡은 뒤 ${minutes(r.agentSeconds)} 만에 복구 (${bounds})${lasts}`,
  );
}

function orderAxis(r: RecoveryReport, share: number): RecoveryAxis {
  const [id, label, max] = ["recovery_order", "복구 순서", RECOVERY_WEIGHTS.order] as const;
  if (!r.byAgent || r.fixAfterSeconds === undefined)
    return nothing(id, label, max, "복구하지 못해서 순서를 매길 수 없어요");
  const points = round(max * ramp(r.fixAfterSeconds, FULL_ORDER_S, ZERO_ORDER_S) * share, 2);
  const bounds = `${minutes(FULL_ORDER_S)} 안이면 만점, ${minutes(ZERO_ORDER_S)} 넘으면 0점`;
  return earned(
    id,
    label,
    max,
    points,
    `맡은 지 ${minutes(r.fixAfterSeconds)} 만에 고쳤어요 (${bounds}). 복구를 먼저 하고 원인을 나중에 찾아도 만점이에요`,
  );
}

function worsenAxis(r: RecoveryReport, names: (id: string) => string): RecoveryAxis {
  const [id, label, max] = ["no_worsening", "복구 중 악화 없음", RECOVERY_WEIGHTS.worsen] as const;
  if (r.worsened.length > 0)
    return {
      id,
      label,
      verdict: "penalty",
      points: -max * r.worsened.length,
      max,
      detail: `조치 뒤에 멀쩡하던 ${r.worsened.map(names).join(", ")}가 멈췄어요 (서비스마다 −${max}점)`,
    };
  if (r.acts === 0) return nothing(id, label, max, "조치를 하지 않아서 판정할 것이 없어요");
  if (!r.byAgent)
    return nothing(id, label, max, "복구하지 못해서 점수가 없어요. 멈춘 서비스가 늘지는 않았어요");
  return earned(id, label, max, max, "조치 때문에 멈춘 서비스가 없어요");
}

/** The three axes of recovery; `lasting` is false when a sheet's lasting condition does not hold at the end. */
export function recoveryAxes(
  report: RecoveryReport,
  lasting: boolean,
  names: (id: string) => string,
): readonly RecoveryAxis[] {
  const share = lasting ? 1 : NOT_LASTING_SHARE;
  return [timeAxis(report, share), orderAxis(report, share), worsenAxis(report, names)];
}
