/**
 * 세계 인기 순서와 좋아요 (REQ-101, ADR-0122): the four sorts, the line of evidence under a card, what an empty board says, and
 * the heart's optimistic count. The score itself is the server's (`worldStats` in core); this only says it in Korean.
 */
import type { LikeView, WorldCardView } from "@terrarium/core/contract";
import type { WorldSort } from "@terrarium/core/experiments";
import type { KeyValueStore } from "./identity";

export const WORLD_SORT_OPTIONS: readonly { readonly value: WorldSort; readonly label: string }[] =
  [
    { value: "popular", label: "인기" },
    { value: "active", label: "요즘 활발" },
    { value: "new", label: "새로 생김" },
    { value: "mine", label: "내 세계" },
  ];

export const DEFAULT_WORLD_SORT: WorldSort = "popular";
export const WORLD_SORT_KEY = "terrarium.worldSort";

/** What this browser remembered; anything unknown, or a storage that refuses, is 인기. */
export function readWorldSort(store: Pick<KeyValueStore, "getItem"> | undefined): WorldSort {
  try {
    const saved = store?.getItem(WORLD_SORT_KEY);
    return WORLD_SORT_OPTIONS.find((o) => o.value === saved)?.value ?? DEFAULT_WORLD_SORT;
  } catch {
    return DEFAULT_WORLD_SORT;
  }
}

/** Remember the choice; a storage that refuses leaves it for this visit only. */
export function saveWorldSort(store: Pick<KeyValueStore, "setItem"> | undefined, sort: WorldSort) {
  try {
    store?.setItem(WORLD_SORT_KEY, sort);
  } catch {
    // kept for this visit only
  }
}

/** One line under the choices that says what the order means. */
export const SORT_NOTES: Readonly<Record<WorldSort, string>> = {
  popular: "최근 30일 실험 수 + 좋아요 + 다른 사람이 이 세계로 시작한 수예요.",
  active: "최근 7일의 실험, 좋아요, 다른 사람이 시작한 수예요.",
  new: "만든 때가 가까운 순서예요.",
  mine: "내가 만든 세계예요. 가장 최근에 고친 순서로 보여요.",
};

const num = (n: number) => n.toLocaleString("ko-KR");

/** "실험 128번 · 좋아요 24 · 이번 주 +12": what the score is made of, with the zeros left out of the tail. */
export function evidenceLine(card: Pick<WorldCardView, "stats" | "likes">): string {
  const { stats } = card;
  if (stats.experiments30d === 0 && card.likes === 0 && stats.startedByOthers === 0)
    return "아직 실험이 없어요";
  const parts = [`실험 ${num(stats.experiments30d)}번`, `좋아요 ${num(card.likes)}`];
  if (stats.startedByOthers > 0) parts.push(`남이 시작 ${num(stats.startedByOthers)}번`);
  if (stats.week > 0) parts.push(`이번 주 +${num(stats.week)}`);
  return parts.join(" · ");
}

/** The hover text of the evidence: the experiment number is the last 30 days, which is what the score counts. */
export const evidenceHint = (card: Pick<WorldCardView, "stats">): string =>
  `실험은 최근 30일(${num(card.stats.experiments30d)}번), 지금까지는 ${num(card.stats.experiments)}번이에요`;

export interface EmptyBoard {
  readonly title: string;
  readonly body: string;
}

/** What to say when the list has nothing to show, or when 인기 has nothing to go on yet. */
export function boardEmpty(sort: WorldSort, worlds: number): EmptyBoard | undefined {
  if (worlds > 0) return undefined;
  if (sort === "mine")
    return { title: "아직 만든 세계가 없어요", body: "세계를 만들면 여기에 모여요." };
  return {
    title: "아직 세계가 없어요",
    body: "세계를 만들면 에이전트가 일할 데이터센터가 생겨요.",
  };
}

/** When no world has anything counted yet, 인기 is only the order they were made in; say so. */
export function quietPopular(sort: WorldSort, cards: readonly WorldCardView[]): string | undefined {
  if (sort !== "popular" && sort !== "active") return undefined;
  const counted = cards.some((c) => (sort === "popular" ? c.stats.score : c.stats.week) > 0);
  if (counted || cards.length === 0) return undefined;
  return sort === "popular"
    ? "아직 실험이 없어요 — 인기는 실험이 쌓이면 생겨요"
    : "이번 주엔 아직 아무 일도 없었어요 — 실험을 돌리거나 좋아요를 누르면 여기에 올라와요";
}

/** The heart pressed, before the server answers. */
export function toggledLike(card: WorldCardView): WorldCardView {
  return {
    ...card,
    likedByMe: !card.likedByMe,
    likes: Math.max(0, card.likes + (card.likedByMe ? -1 : 1)),
  };
}

/** The server's count replaces the guess; the score follows the heart, which is one point each. */
export function settledLike(card: WorldCardView, view: LikeView): WorldCardView {
  const diff = view.likes - card.likes;
  return {
    ...card,
    likes: view.likes,
    likedByMe: view.likedByMe,
    stats: { ...card.stats, likes: view.likes, score: card.stats.score + diff },
  };
}

export const likeLabel = (card: Pick<WorldCardView, "likes" | "likedByMe" | "name">): string =>
  `${card.name} 좋아요${card.likedByMe ? " 취소" : ""} (지금 ${num(card.likes)})`;
