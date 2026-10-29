/**
 * How numbers, times and states read on screen. One place, so "67%" and "3분 전" look the same everywhere.
 */
import type { ExperimentStatus, RunStatus } from "@terrarium/core/experiments";
import { RUN_STATUS_LABELS } from "@terrarium/core/experiments";
import { formatDuration } from "@terrarium/core/kernel";

export { formatDuration };

/** The colour family a state is drawn in (see the design tokens). */
export type Tone = "neutral" | "busy" | "good" | "warn" | "bad";

export const STATUS_TONES: Readonly<Record<RunStatus, Tone>> = {
  queued: "neutral",
  running: "busy",
  completed: "good",
  failed: "bad",
  cancelled: "neutral",
};

export function statusLabel(status: RunStatus | ExperimentStatus): string {
  return RUN_STATUS_LABELS[status];
}

export const percent = (ratio: number, digits = 0) => `${(ratio * 100).toFixed(digits)}%`;

/** "72.5점", or a dash when there is no score yet. */
export const scoreText = (score: number | null | undefined) =>
  score === null || score === undefined
    ? "—"
    : `${Number.isInteger(score) ? score : score.toFixed(1)}점`;

/** A mean with its 95% interval, e.g. "72.5 ± 4.1". */
export function meanText(
  summary: { mean: number; ci95: number; n: number } | undefined,
  unit = "",
  digits = 1,
): string {
  if (!summary) return "—";
  const mean = `${summary.mean.toFixed(digits)}${unit}`;
  return summary.n > 1 && summary.ci95 > 0 ? `${mean} ± ${summary.ci95.toFixed(digits)}` : mean;
}

const KO_NUMBER = new Intl.NumberFormat("ko-KR");
export const count = (n: number) => KO_NUMBER.format(n);

/** Power in the unit that reads best: 850 W, 12.4 kW, 1.2 MW. */
export function watts(w: number): string {
  if (Math.abs(w) >= 1e6) return `${(w / 1e6).toFixed(1)} MW`;
  if (Math.abs(w) >= 1e3) return `${(w / 1e3).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

/** Money in millions of KRW as people say it: 850만 원, 3.2억 원. */
export function won(millions: number): string {
  if (millions >= 100) return `${(millions / 100).toFixed(millions >= 1000 ? 0 : 1)}억 원`;
  return `${KO_NUMBER.format(Math.round(millions * 100))}만 원`;
}

export const celsius = (c: number) => `${c.toFixed(1)}°C`;

/** "방금", "3분 전", "어제", or the date, from an ISO time. */
export function relativeTime(iso: string, nowMs: number): string {
  const seconds = Math.round((nowMs - Date.parse(iso)) / 1000);
  if (seconds < 45) return "방금";
  if (seconds < 3600) return `${Math.round(seconds / 60)}분 전`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}시간 전`;
  if (seconds < 2 * 86_400) return "어제";
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}일 전`;
  return dateText(iso);
}

/** "10월 29일 14:05" (this year) or "2025년 10월 29일". */
export function dateText(iso: string, nowMs?: number): string {
  const d = new Date(iso);
  const sameYear = nowMs === undefined || new Date(nowMs).getFullYear() === d.getFullYear();
  const day = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  if (!sameYear) return `${d.getFullYear()}년 ${day}`;
  return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Simulated time on a run's clock: "+12분 30초" after the scenario started. */
export const simTime = (seconds: number) => `+${formatDuration(seconds)}`;
