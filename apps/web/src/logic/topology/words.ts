/**
 * The words of the topology view (REQ-078): the labels, the sentence a screen reader gets for the picture, and what is
 * said under a tile. The glossary's rules: 해요체, one fact to a sentence, Arabic numerals with units, "고장" and
 * "알람", never "장애". Kept apart from the drawing so a test can read every sentence.
 */
import { type Board, LAYER_LABELS, num, type Tile } from "@terrarium/core/topology";

export const TOPO_WORDS = {
  layers: "층",
  impact: "영향 범위",
  noImpact: "영향받는 곳이 없어요",
  notRun: "돌려 보면 알람과 영향 범위가 나와요",
  run: "돌려 보기",
  loading: "토폴로지를 불러오고 있어요",
  whole: "전체",
  path: "펼친 곳",
  fold: "한 단계 접기",
  openHint: "누르면 한 단계 펼쳐져요",
  legend: "색의 뜻",
  fault: "고장",
  alarm: "알람",
  touch: "에이전트가 만지는 곳",
  range: "영향 범위",
  stop: "멈춰 보기",
  start: "다시 돌려 보기",
  time: "시간",
  scrub: "돌린 시간 고르기",
  none: "이 세계에는 이 층에 그릴 장비가 없어요",
  selected: "고른 것",
  notHere: "고른 것이 이 층에는 없어요",
} as const;

/** "그린 타일 7개 · 접힌 것 16,565개": how much of the world is drawn. */
export function drawnText(board: Board): string {
  const { tiles, folded } = board.stats;
  return folded > 0
    ? `그린 타일 ${num(tiles)}개 · 접힌 것 ${num(folded)}개`
    : `타일 ${num(tiles)}개를 모두 그렸어요`;
}

const count = (board: Board, state: Tile["state"]): number =>
  board.tiles.filter((t) => t.state === state).reduce((n, t) => n + t.count, 0);

/** The one sentence a screen reader gets for the picture. */
export function pictureText(board: Board): string {
  const stages = board.stages.map((s) => s.label).join(", ");
  const faults = count(board, "fault");
  const alarms = count(board, "alarm");
  const trouble =
    faults + alarms === 0
      ? "고장과 알람은 없어요"
      : `고장 ${num(faults)}곳, 알람 ${num(alarms)}곳이 있어요`;
  return `${LAYER_LABELS[board.layer]} 토폴로지예요. ${stages} 순서로 이어지고, 타일 ${num(board.tiles.length)}개로 그렸어요. ${trouble}`;
}

/** The name of a tile for a screen reader: what it is, how it is doing, and what pressing it does. */
export function tileText(tile: Tile): string {
  const line = tile.line ? `, ${tile.line}` : "";
  if (!tile.group) return `${tile.name}${line}`;
  return tile.open ? `${tile.name}${line}. ${TOPO_WORDS.openHint}` : `${tile.name}${line}`;
}
