/** Piecewise-linear tables (REQ-113): the same x always gives the same y, held flat past both ends. */
import type { Point } from "./types";

/** Problems with a table, in Korean; empty when it can be used. `name` says which table in the message. */
export function curveProblems(
  name: string,
  points: unknown,
  range?: { xMin: number; xMax: number; yMin: number; yMax: number },
): string[] {
  if (!Array.isArray(points) || points.length < 2) return [`${name}: 점이 두 개 이상 있어야 해요`];
  const out: string[] = [];
  let prev = Number.NEGATIVE_INFINITY;
  for (const [i, p] of points.entries()) {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !p.every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      out.push(`${name}: ${i + 1}번째 점이 [x, y] 두 숫자가 아니에요`);
      continue;
    }
    const [x, y] = p as [number, number];
    if (!(x > prev))
      out.push(`${name}: ${i + 1}번째 점의 x(${x})가 앞 점보다 커야 해요 (x는 늘어나는 순서)`);
    prev = x;
    if (range) out.push(...rangeProblems(`${name}: ${i + 1}번째 점`, x, y, range));
  }
  return out;
}

function rangeProblems(
  where: string,
  x: number,
  y: number,
  r: { xMin: number; xMax: number; yMin: number; yMax: number },
): string[] {
  const out: string[] = [];
  if (x < r.xMin || x > r.xMax)
    out.push(`${where}의 x(${x})가 허용 범위 ${r.xMin}~${r.xMax}를 벗어나요`);
  if (y < r.yMin || y > r.yMax)
    out.push(`${where}의 y(${y})가 허용 범위 ${r.yMin}~${r.yMax}를 벗어나요`);
  return out;
}

/** y at x: straight lines between the points, the first or last y outside them. `points` must already be valid. */
export function interpolate(points: readonly Point[], x: number): number {
  const first = points[0] as Point;
  if (!(x > first[0])) return first[1];
  const last = points[points.length - 1] as Point;
  if (x >= last[0]) return last[1];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((points[mid] as Point)[0] <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo] as Point;
  const b = points[hi] as Point;
  return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
}

export interface WeatherRow {
  readonly timeS: number;
  readonly outdoorC: number;
  readonly humidityPct?: number;
}

/** Read `time_s,outdoor_c[,humidity_pct]` lines (a header line and blank lines are skipped). Problems come back in Korean. */
export function parseWeatherCsv(text: string): { rows: WeatherRow[]; problems: string[] } {
  const rows: WeatherRow[] = [];
  const problems: string[] = [];
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const cells = line.split(",").map((c) => c.trim());
    if (rows.length === 0 && Number.isNaN(Number(cells[0])) && n === 0) continue; // header
    const nums = cells.map(Number);
    if (cells.length < 2 || cells.length > 3 || nums.some((v) => !Number.isFinite(v))) {
      problems.push(`${n + 1}번째 줄: time_s,outdoor_c[,humidity_pct] 숫자여야 해요`);
      continue;
    }
    rows.push({
      timeS: nums[0] as number,
      outdoorC: nums[1] as number,
      ...(nums[2] === undefined ? {} : { humidityPct: nums[2] }),
    });
  }
  return { rows, problems };
}
