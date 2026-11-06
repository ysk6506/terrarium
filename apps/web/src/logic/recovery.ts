/**
 * What a run page says about a scenario with services (REQ-088, ADR-0091): the first three numbers are the service's
 * recovery time, whether this run recovered it without a person, and whether it made things worse on the way; then
 * what the trouble cost. Pure text from the score, so a test can read it.
 */
import type { Score } from "@terrarium/core/oracle";
import type { CommonReach, RecoveryPath } from "@terrarium/core/session";
import { toolSpec } from "@terrarium/core/tools";
import { formatDuration, won } from "./format";

export interface Figure {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}

/** What a result says when the tools a real team has never lead to the equipment the answer names. */
export const NO_COMMON_PATH_TEXT = "흔한 툴만으로는 원인에 닿을 수 없어요";

/** The recovery numbers of a score, or nothing when the run was scored as written (no services in it). */
export function recoveryFigures(score: Score | undefined): readonly Figure[] {
  const r = score?.recovery;
  if (!r || score?.scoring !== "recovery") return [];
  const worse = r.worsened.length;
  return [
    {
      label: "서비스 복구 시간",
      value: r.recovered ? formatDuration(Math.round(r.seconds)) : "복구 못 함",
      hint:
        r.impairedAt === undefined
          ? "서비스가 멈추거나 느려진 적이 없어요"
          : `처음 멈춘 때부터 모두 정상이 될 때까지예요. 일을 맡은 뒤로는 ${formatDuration(Math.round(r.agentSeconds))}`,
    },
    {
      label: "사람 없이 복구한 비율",
      value: r.byAgent ? "복구됨" : r.byCluster ? "클러스터가 알아서 복구" : "안 됨",
      hint: r.byCluster
        ? `클러스터가 ${formatDuration(Math.round(r.clusterAfterSeconds ?? 0))} 만에 스스로 승격해서 돌아왔어요. 에이전트가 한 복구가 아니라서 세지 않아요`
        : "이 실행 하나는 복구됨 아니면 안 됨이에요. 같은 시나리오를 여러 번 돌리면 비율이 돼요",
    },
    {
      label: "복구 중 악화",
      value: worse > 0 ? "있음" : "없음",
      hint:
        worse > 0
          ? `조치 뒤에 멀쩡하던 서비스 ${worse}개가 멈췄어요`
          : "조치 때문에 멈춘 서비스가 없어요",
    },
    cost(r.costKrw, r.delayHours),
  ];
}

function cost(krw: number, delayHours: number): Figure {
  const parts = [
    ...(krw > 0 || delayHours === 0 ? [krw === 0 ? "0원" : won(krw / 1_000_000)] : []),
    ...(delayHours > 0 ? [`${delayHours}시간 지연`] : []),
  ];
  return {
    label: "사고 비용(추정)",
    value: parts.join(" · "),
    hint: "멈춘 시간 × 시간당 피해예요. 느린 시간은 30%만 세요. 피해 값은 어림한 값이에요",
  };
}

/** The line under the numbers when the common tools do not reach the cause; nothing when they do or it is not known. */
export function commonPathNote(reach: CommonReach | undefined): string | undefined {
  return reach && !reach.reached ? NO_COMMON_PATH_TEXT : undefined;
}

/** Which rules scored the run, for the heading of the scoring sheet. */
export function scoringText(score: Score | undefined): string {
  return score?.scoring === "recovery" ? "복구 우선 채점" : "항목별 채점";
}

/** The two facts the variance check adds, as lines for its panel: a way to recover by moving, a way to the cause. */
export function probeLines(
  path: RecoveryPath | undefined,
  reach: CommonReach | undefined,
): readonly { readonly label: string; readonly value: string; readonly good: boolean }[] {
  const lines = [];
  if (path?.applicable)
    lines.push({
      label: "서비스를 옮겨서 복구하는 길",
      value: path.note,
      good: path.ok,
    });
  if (reach) {
    const via = reach.via.map((t) => toolSpec(t)?.title ?? t).join(" → ");
    lines.push({
      label: "흔한 툴만으로 원인에 닿는 길",
      value: reach.reached
        ? `있어요. ${via}, ${reach.calls}번`
        : `없어요. 알람에서 출발해 ${reach.calls}번 따라가도 정답 장비가 나오지 않아요`,
      good: reach.reached,
    });
  }
  return lines;
}
