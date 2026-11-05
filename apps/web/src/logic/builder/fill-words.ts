/**
 * What "서버룸 채우기" asks, said as results (REQ-077, ADR-0083): not "서버 절반쯤" but what a rack then holds and
 * draws — "랙마다 서버 7대, 전력 4 kW" — so a choice can be made without knowing what the words stand for.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { type FillAisle, type FillLoad, rackLoad } from "./fill-plan";

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

const kw = (w: number): string => `${Math.round(w / 100) / 10} kW`;

/** How full the racks are: the servers in a rack and the power it draws. */
export function loadChoices(catalog: Catalog): Choice<FillLoad>[] {
  const line = (load: FillLoad, head: string): Choice<FillLoad> => {
    const one = rackLoad(catalog, load);
    return { value: load, label: `${head} · 랙마다 서버 ${one.servers}대, 전력 ${kw(one.heatW)}` };
  };
  return [
    { value: "empty", label: "서버 없이 랙만 · 서버는 나중에 달아요" },
    line("half", "서버 절반쯤"),
    line("full", "서버 가득"),
  ];
}

/** The aisles between the rows: left open, or covered on the cold side or the hot side. */
export const AISLE_CHOICES: readonly Choice<FillAisle>[] = [
  { value: "none", label: "복도를 덮지 않아요" },
  { value: "cold", label: "냉복도를 덮어요 · 찬 공기를 가둬요" },
  { value: "hot", label: "열복도를 덮어요 · 더운 공기를 모아요" },
];
