/**
 * The world list as cards in the order people ask for (REQ-101, ADR-0122): 인기 / 요즘 활발 / 새로 생김 / 내 세계, remembered in
 * this browser. Used by the home page (a few cards) and by `/worlds` (all of them).
 */
import type { WorldCardView } from "@terrarium/core/contract";
import type { WorldSort } from "@terrarium/core/experiments";
import { useRef, useState } from "react";
import {
  boardEmpty,
  type EmptyBoard,
  quietPopular,
  readWorldSort,
  SORT_NOTES,
  saveWorldSort,
  settledLike,
  toggledLike,
  WORLD_SORT_OPTIONS,
} from "../../logic";
import { pickByText, useMossScreen, worldsState } from "../../moss";
import { browserStore } from "../browser-store";
import { Go, useApp, useAsync } from "../context";
import { Empty, Failure, Loading, Section, Segmented } from "../kit";
import { WorldCard } from "./world-card";

function useWorldBoard(limit?: number) {
  const { api, me, askName, toast } = useApp();
  const [sort, setSort] = useState<WorldSort>(() => readWorldSort(browserStore()));
  const list = useAsync(
    (signal) => api.call("listWorlds", { query: { sort }, signal }),
    [sort, me],
  );
  const choose = (next: WorldSort) => {
    saveWorldSort(browserStore(), next);
    setSort(next);
  };
  // the list as it is now, not as it was when the heart was pressed: another heart may have landed meanwhile
  const latest = useRef(list.data);
  latest.current = list.data;
  const replace = (card: WorldCardView) =>
    latest.current && list.set(latest.current.map((c) => (c.id === card.id ? card : c)));
  const toggle = async (card: WorldCardView) => {
    if (!me) return askName();
    replace(toggledLike(card));
    try {
      const view = await api.call(card.likedByMe ? "unlikeWorld" : "likeWorld", {
        params: { id: card.id },
      });
      replace(settledLike(toggledLike(card), view));
    } catch (err) {
      replace(card);
      toast((err as Error).message, "bad");
    }
  };
  useMossScreen(limit ? "home" : "worlds", {
    ...(limit ? {} : { read: () => worldsState(sort, list.data ?? []) }),
    run: limit
      ? {}
      : {
          "worlds-sort": (a) => {
            const hit = pickByText(String(a.text ?? ""), WORLD_SORT_OPTIONS, (o) => o.label);
            const next = hit ?? WORLD_SORT_OPTIONS.find((o) => o.value !== sort);
            if (!next) throw new Error("바꿀 순서가 없어요");
            choose(next.value);
            return next.label;
          },
        },
  });
  return { sort, choose, list, toggle };
}

type Board = ReturnType<typeof useWorldBoard>;

function BoardBody({
  board,
  limit,
  empty,
}: {
  readonly board: Board;
  readonly limit?: number;
  readonly empty?: EmptyBoard;
}) {
  const { sort, choose, list, toggle } = board;
  const cards = list.data ?? [];
  const shown = limit ? cards.slice(0, limit) : cards;
  const quiet = quietPopular(sort, cards);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 14 }}>
        <Segmented label="세계 순서" value={sort} options={WORLD_SORT_OPTIONS} onChange={choose} />
        <span className="small muted">{SORT_NOTES[sort]}</span>
      </div>
      {list.error && <Failure error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {quiet && <p className="small muted">{quiet}</p>}
      {empty && <Empty title={empty.title}>{empty.body}</Empty>}
      {shown.length > 0 && (
        <div className="world-grid">
          {shown.map((c) => (
            <WorldCard
              key={c.id}
              card={c}
              onToggle={(x) => void toggle(x)}
              compact={Boolean(limit)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * With a `limit` it is the home page's world section: a few cards under a heading that stays out of the way when there is
 * nothing to show. Without one it is the whole list of `/worlds`.
 */
export function WorldBoard({ limit }: { readonly limit?: number }) {
  const board = useWorldBoard(limit);
  const { sort, list } = board;
  const empty = list.data ? boardEmpty(sort, list.data.length) : undefined;
  // on the home page a workspace with no worlds at all stays quiet: the hero already offers the way to one
  if (limit && empty && sort !== "mine") return null;
  const body = <BoardBody board={board} empty={empty} {...(limit ? { limit } : {})} />;
  if (!limit) return body;
  return (
    <Section title="세계" aside={<Go to={{ name: "worlds" }}>전부 보기</Go>}>
      {body}
    </Section>
  );
}
