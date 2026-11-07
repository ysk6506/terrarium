/**
 * The words of the airflow map (REQ-072, ADR-0074), apart from its calculation so the screen that has no map
 * does not carry the calculation: the labels, the line that says it is not CFD, and the three things it can show.
 */
import { INLET_WARNING_C, RACK_CRITICAL_C } from "@terrarium/core/physics";
import { celsius } from "../format";

/** The three things the map can show, one at a time. */
export type AirView = "inlet" | "outlet" | "flow";

export const AIR_VIEWS: ReadonlyArray<{ readonly id: AirView; readonly label: string }> = [
  { id: "inlet", label: "흡기 온도" },
  { id: "outlet", label: "배기 온도" },
  { id: "flow", label: "공기 흐름" },
];

/** Always on screen next to the map (ADR-0074). */
export const AIR_NOTE = "냉방기 풍량과 랙 발열로 계산한 방향과 세기예요. 유체 해석(CFD)이 아니에요";

export const AIR_WORDS = {
  flat: "3D",
  top: "위에서 본 지도",
  how: "보는 방법",
  what: "보는 것",
  title: "온도와 공기 흐름",
  open: "온도와 공기 흐름 보기",
  loading: "온도와 공기 흐름을 불러오고 있어요",
  unitOn: "돌아가는 중",
  unitOff: "멈춤",
  units: "냉방기",
  noUnits: "이 방에는 냉방기가 없어요",
  none: "시운전하면 온도와 공기 흐름이 나와요",
  run: "시운전",
  liquid: "액체로 식히는 방이라 온도만 보여요. 공기 흐름은 그리지 않아요",
  supply: "차가운 바람: 냉방기에서 랙 앞으로",
  exhaust: "더운 바람: 랙 뒤에서 냉방기로",
  strong: "화살표가 빠르고 진할수록 센 바람이에요",
  racks: "랙",
  pickHint: "랙을 가리키거나 누르면 숫자가 나와요",
  stopUnit: "멈춰 보기",
  startUnit: "다시 시운전",
  time: "시간",
  scrub: "돌린 시간 고르기",
  inlet: "흡기",
  outlet: "배기",
  gap: "차이",
  warn: "경고",
  critical: "심각",
} as const;

/** How far an inlet temperature is from the warning and critical lines the physics raises alarms at. */
export function marginText(inletC: number): string {
  if (inletC > RACK_CRITICAL_C)
    return `심각선 ${RACK_CRITICAL_C}°C를 ${celsius(inletC - RACK_CRITICAL_C)} 넘었어요`;
  if (inletC > INLET_WARNING_C)
    return `경고선 ${INLET_WARNING_C}°C를 넘었고 심각선까지 ${celsius(RACK_CRITICAL_C - inletC)} 남았어요`;
  return `경고선 ${INLET_WARNING_C}°C까지 ${celsius(INLET_WARNING_C - inletC)} 남았어요`;
}

/** The words for the hottest rack. */
export const hottestText = (name: string, inletC: number): string =>
  `가장 더운 곳 · ${name} 흡기 ${celsius(inletC)} · ${marginText(inletC)}`;

/** Where in the run a frame is, in words: "시작", "30초 뒤", "5분 30초 뒤". */
export function frameText(seconds: number): string {
  if (seconds <= 0) return "시작";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m > 0 ? `${m}분 ` : ""}${s > 0 ? `${s}초 ` : ""}뒤`.trim();
}
