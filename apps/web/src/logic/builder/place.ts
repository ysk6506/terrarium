/**
 * "놓기" (REQ-102, ADR-0123): the one list of what can be put down where the person is, in place of the left palette. It
 * is read off the bundles (`toolsFor`), so what fits a level is said in one place. A kind with one way to be put down
 * takes the tool at once; a kind with several (cooling units, power equipment, building purposes) asks the type next.
 */
import type { Catalog, RackModel } from "@terrarium/core/catalog";
import { won } from "../format";
import type { Level } from "./levels";
import { type BundleMain, type ToolBundle, type ToolPick, type ToolView, toolsFor } from "./tools";

export interface PlaceKind {
  readonly id: string;
  readonly title: string;
  /** One small line under the title. */
  readonly line: string;
  /** Put down with this at once. */
  readonly direct?: BundleMain;
  /** Or ask which one of these first. */
  readonly ask?: readonly ToolPick[];
}

/** "인로우 30kW" out of "냉방기 — 인로우 30kW". */
const nameOf = (pick: ToolPick): string => pick.label.split(" — ").at(-1) ?? pick.label;

const joined = (picks: readonly ToolPick[], max = 3): string =>
  picks.slice(0, max).map(nameOf).join(" · ");

function rackLine(catalog: Catalog): string {
  const rack = catalog
    .list("rack")
    .find((m): m is RackModel => m.kind === "rack" && m.form === "rack" && !m.standard);
  return rack ? `${rack.uHeight}U · ${won(rack.costM)}` : "서버를 끼우는 틀";
}

type Maker = (bundle: ToolBundle, catalog: Catalog) => PlaceKind[];

const askOrDirect = (bundle: ToolBundle): Pick<PlaceKind, "ask" | "direct"> =>
  bundle.picks.length > 0 ? { ask: bundle.picks } : bundle.main ? { direct: bundle.main } : {};

const landKinds: Maker = (bundle) => [
  {
    id: "land",
    title: "땅 사기",
    line: bundle.line ?? "",
    // The sheet lists the land for sale itself (buying is not a tool in hand).
    ...(bundle.main ? { ask: [] } : {}),
  },
];

const roomKinds: Maker = ({ main, picks }) => [
  { id: "rooms", title: "서버룸", line: "랙을 놓는 방", ...(main ? { direct: main } : {}) },
  ...(picks.length > 0
    ? [{ id: "other-rooms", title: "다른 방", line: "전기실 · 기계실 · 사무실", ask: picks }]
    : []),
];

const rackKinds: Maker = ({ main, picks, line }, catalog) => [
  main?.kind === "widen"
    ? { id: "racks", title: "랙", line: line ?? "", direct: main }
    : { id: "racks", title: "랙", line: rackLine(catalog), ...(main ? { direct: main } : {}) },
  ...(picks.length > 0
    ? [{ id: "aisle", title: "복도 덮개", line: "냉복도 · 열복도", ask: picks }]
    : []),
];

const MAKERS: Readonly<Record<string, Maker>> = {
  land: landKinds,
  building: (b) => [
    {
      id: "building",
      title: "건물",
      line: b.line ?? "데이터센터 · 공장 · 연구동",
      ...askOrDirect(b),
    },
  ],
  outside: (b) => [
    { id: "outside", title: "건물 밖 설비", line: "변압기 · 발전기 · 칠러", ask: b.picks },
  ],
  rooms: roomKinds,
  racks: rackKinds,
  cooling: (b) => [{ id: "cooling", title: "냉방기", line: joined(b.picks), ask: b.picks }],
};

const powerKinds: Maker = (b) => [
  { id: "power", title: "전기 설비", line: "분전반 · UPS", ask: b.picks },
];

const kindsOf = (bundle: ToolBundle, catalog: Catalog): PlaceKind[] =>
  (MAKERS[bundle.id] ?? powerKinds)(bundle, catalog);

/** What fits the level, kind by kind. */
export function placeKinds(level: Level, catalog: Catalog, view: ToolView): PlaceKind[] {
  return toolsFor(level, catalog, view).flatMap((b) => kindsOf(b, catalog));
}

/** Every word of the sheet, for the test that holds them to the style rules. */
export function placeTexts(kinds: readonly PlaceKind[]): string[] {
  return kinds.flatMap((k) => [
    k.title,
    k.line,
    ...(k.direct ? [k.direct.label] : []),
    ...(k.ask ?? []).flatMap((p) => [p.label, p.hint]),
  ]);
}
