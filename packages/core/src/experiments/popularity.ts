/**
 * How popular a world is (REQ-101, ADR-0122), worked out from records the platform already keeps. Pure: the caller hands in
 * what it has and the time it wants it judged at.
 *
 *   인기 점수  = 최근 30일 실험 수 + 좋아요 수 + 다른 사람이 이 세계로 시작한 수
 *   요즘 활발 = 최근 7일의 실험 수 + 좋아요 + 다른 사람이 시작한 수
 *
 * Ties break by when the world was made (newer first), then by id, so the order never flickers.
 */
import type { WorldLike } from "./community";

export const POPULAR_DAYS = 30;
export const ACTIVE_DAYS = 7;
const DAY_MS = 86_400_000;

export const WORLD_SORTS = ["popular", "active", "new", "mine"] as const;
export type WorldSort = (typeof WORLD_SORTS)[number];

export interface PopularWorld {
  readonly id: string;
  readonly owner: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The world or template this one was made from. */
  readonly startedFrom?: string;
}

export interface PopularExperiment {
  readonly worldId: string;
  readonly createdAt: string;
}

export interface WorldStats {
  /** Experiments made on the world in the last 30 days. */
  readonly experiments30d: number;
  /** Experiments ever made on it. */
  readonly experiments: number;
  readonly likes: number;
  /** Worlds other people started from this one. */
  readonly startedByOthers: number;
  /** The 인기 score. */
  readonly score: number;
  /** Experiments, hearts and starts in the last 7 days. */
  readonly week: number;
}

const EMPTY: WorldStats = {
  experiments30d: 0,
  experiments: 0,
  likes: 0,
  startedByOthers: 0,
  score: 0,
  week: 0,
};

export interface PopularityInput {
  readonly worlds: readonly PopularWorld[];
  readonly experiments: readonly PopularExperiment[];
  readonly likes: readonly WorldLike[];
  /** The moment to judge at (ISO 8601). */
  readonly now: string;
}

type Mutable = { -readonly [K in keyof WorldStats]: WorldStats[K] };

type Counter = (at: string, days: number) => boolean;

function countExperiments(
  out: Map<string, Mutable>,
  experiments: readonly PopularExperiment[],
  within: Counter,
): void {
  for (const e of experiments) {
    const s = out.get(e.worldId);
    if (!s) continue;
    s.experiments += 1;
    if (within(e.createdAt, POPULAR_DAYS)) s.experiments30d += 1;
    if (within(e.createdAt, ACTIVE_DAYS)) s.week += 1;
  }
}

function countLikes(out: Map<string, Mutable>, likes: readonly WorldLike[], within: Counter) {
  for (const l of likes) {
    const s = out.get(l.worldId);
    if (!s) continue;
    s.likes += 1;
    if (within(l.at, ACTIVE_DAYS)) s.week += 1;
  }
}

/** A world another person made from this one counts for it; one the same person made does not. */
function countStarts(out: Map<string, Mutable>, worlds: readonly PopularWorld[], within: Counter) {
  const owners = new Map(worlds.map((w) => [w.id, w.owner]));
  for (const w of worlds) {
    const from = w.startedFrom ? out.get(w.startedFrom) : undefined;
    if (!from || owners.get(w.startedFrom as string) === w.owner) continue;
    from.startedByOthers += 1;
    if (within(w.createdAt, ACTIVE_DAYS)) from.week += 1;
  }
}

/** The evidence for every world named in `worlds`. */
export function worldStats(input: PopularityInput): Map<string, WorldStats> {
  const now = Date.parse(input.now);
  const within: Counter = (at, days) => {
    const age = now - Date.parse(at);
    return age >= 0 && age <= days * DAY_MS;
  };
  const out = new Map<string, Mutable>(input.worlds.map((w) => [w.id, { ...EMPTY }]));
  countExperiments(out, input.experiments, within);
  countLikes(out, input.likes, within);
  countStarts(out, input.worlds, within);
  for (const s of out.values()) s.score = s.experiments30d + s.likes + s.startedByOthers;
  return out;
}

const none = (): WorldStats => EMPTY;

function byNewest(a: PopularWorld, b: PopularWorld): number {
  return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

/** The worlds in the order the sort asks for. `mine` keeps only the viewer's own, last edited first. */
export function sortWorlds<W extends PopularWorld>(
  worlds: readonly W[],
  stats: ReadonlyMap<string, WorldStats>,
  sort: WorldSort,
  viewer: string,
): W[] {
  const of = (w: W) => stats.get(w.id) ?? none();
  const list = [...worlds];
  if (sort === "mine")
    return list
      .filter((w) => w.owner === viewer)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byNewest(a, b));
  if (sort === "new") return list.sort(byNewest);
  const key = (w: W) => (sort === "popular" ? of(w).score : of(w).week);
  return list.sort((a, b) => key(b) - key(a) || byNewest(a, b));
}
