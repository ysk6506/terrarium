/**
 * Small charts drawn as SVG paths (REQ-037): a run's metric over simulated time, a score with its
 * interval. Kept here so the shapes are tested and the view only draws strings.
 */

export interface Box {
  readonly w: number;
  readonly h: number;
}

/** Round numbers for an axis that covers min..max in about `count` steps. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ??
    raw) as number;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export interface LineChart {
  /** SVG path data for the line ("M…L…"). */
  readonly path: string;
  readonly yTicks: readonly { readonly value: number; readonly y: number }[];
  readonly xTicks: readonly { readonly value: number; readonly x: number }[];
  readonly domain: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
  /** Where a value would be drawn, for a marker or a threshold line. */
  readonly yOf: (value: number) => number;
  readonly xOf: (value: number) => number;
}

/** A line through [t, value] points, fitted to the box with a little headroom. */
export function lineChart(
  points: ReadonlyArray<readonly [number, number]>,
  box: Box,
  yFloor?: number,
): LineChart {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = xs.length ? Math.min(...xs) : 0;
  const x1 = xs.length ? Math.max(...xs) : 1;
  let y0 = ys.length ? Math.min(...ys) : 0;
  let y1 = ys.length ? Math.max(...ys) : 1;
  if (yFloor !== undefined) y0 = Math.min(y0, yFloor);
  const pad = (y1 - y0) * 0.1 || Math.abs(y1) * 0.1 || 1;
  y0 -= pad;
  y1 += pad;
  const xOf = (v: number) => ((v - x0) / (x1 - x0 || 1)) * box.w;
  const yOf = (v: number) => box.h - ((v - y0) / (y1 - y0)) * box.h;
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${xOf(x).toFixed(1)} ${yOf(y).toFixed(1)}`)
    .join("");
  return {
    path,
    yTicks: niceTicks(y0, y1, 3).map((value) => ({ value, y: yOf(value) })),
    xTicks: niceTicks(x0, x1, 4).map((value) => ({ value, x: xOf(value) })),
    domain: { x: [x0, x1], y: [y0, y1] },
    yOf,
    xOf,
  };
}

/** A score bar: where the mean sits and how wide its 95% interval is, on 0..100. */
export function scoreBar(mean: number, ci95: number, width: number) {
  const at = (v: number) => (Math.min(100, Math.max(0, v)) / 100) * width;
  return { x: at(mean), from: at(mean - ci95), to: at(mean + ci95) };
}
