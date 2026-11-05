/**
 * 여기서 할 일 (REQ-077, ADR-0083): the left panel offers only what can be put down at the level being looked at,
 * in bundles. A bundle has one big button (what it does, as a result: "건물 올리기") and a list of what it can be
 * made of, named by what each is for ("냉방기 — 인로우 30kW"). Prices are not in the list; they show when a thing is
 * put down. A bundle with nothing to choose, or nowhere to put anything, says so in one line and keeps its button.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  BUILDING_PURPOSE_LABELS,
  BUILDING_PURPOSES,
  type BuildingPurpose,
  type RoomPurpose,
} from "@terrarium/core/world";
import { ROOM_WORDS } from "./edit";
import type { Tool } from "./gesture";
import type { Level } from "./levels";
import { WIDEN_ROOM } from "./room-space";
import { COLORS } from "./scene";

/** What a bundle's big button does: take a tool in hand, or take the person to widening the room. */
export type BundleMain =
  | { readonly kind: "tool"; readonly label: string; readonly tool: Tool }
  | { readonly kind: "widen"; readonly label: string };

export interface ToolPick {
  readonly tool: Tool;
  /** What it is for, then which: "냉방기 — 인로우 30kW". */
  readonly label: string;
  readonly swatch: string;
  readonly hint: string;
}

export interface ToolBundle {
  readonly id: string;
  readonly title: string;
  /** The big button; none when there is nothing to do with this bundle here. */
  readonly main?: BundleMain;
  /** What it can be made of; empty when the bundle shows a line instead. */
  readonly picks: readonly ToolPick[];
  /** One line of what is the case here ("여기엔 아직 건물이 없어요"), shown in place of the list. */
  readonly line?: string;
  /** A word to say once, under the list (the first time a hard word shows). */
  readonly note?: string;
}

/** What is at a level that decides which bundles say a line. */
export interface ToolView {
  readonly buildings: number;
  readonly forSale: number;
  readonly rooms: number;
  readonly roomFull: boolean;
}

const rgb = (c: readonly [number, number, number]) =>
  `rgb(${c.map((v) => Math.round(v * 255)).join(" ")})`;

/** What each piece of equipment is for, and its short name; the model's own name is long. */
const USES: Readonly<Record<string, readonly [use: string, name: string]>> = {
  "inrow-30kw": ["냉방기", "인로우 30kW"],
  "crah-100kw": ["냉방기", "항온항습기 100kW"],
  "panel-400a": ["전기 나누기", "분전반 400A"],
  "panel-225a": ["전기 나누기", "분전반 225A"],
  "ups-500kva": ["전기 백업", "UPS 500kVA"],
  "ups-200kva": ["전기 백업", "UPS 200kVA"],
  "sy-transformer-2500kva": ["전기 들이기", "변압기 2,500kVA"],
  "tg-diesel-2mw": ["비상 발전", "디젤 발전기 2MW"],
  "gl-chiller-screw-2mw": ["냉수 만들기", "칠러 2MW"],
  "gl-drycooler-2mw": ["물 식히기", "드라이쿨러 2MW"],
};

/** Every model the bundles name, so a test can check the catalog still has them. */
export const NAMED_MODELS: readonly string[] = Object.keys(USES);

const POWER_MODELS = ["panel-400a", "panel-225a", "ups-500kva", "ups-200kva"] as const;
const COOLING_MODELS = ["inrow-30kw", "crah-100kw"] as const;
const PLANT_MODELS = [
  "sy-transformer-2500kva",
  "tg-diesel-2mw",
  "gl-chiller-screw-2mw",
  "gl-drycooler-2mw",
] as const;

function equipment(
  catalog: Catalog,
  modelId: string,
  swatch: string,
  as: "equipment" | "plant" = "equipment",
): ToolPick {
  const [use, name] = USES[modelId] ?? [catalog.get(modelId).name, ""];
  const model = catalog.get(modelId);
  return {
    tool: as === "plant" ? { kind: "plant", modelId } : { kind: "equipment", modelId },
    label: name ? `${use} — ${name}` : use,
    swatch,
    hint: model.description,
  };
}

const BUILDING_HINTS: Readonly<Record<BuildingPurpose, string>> = {
  data_center: "서버룸을 모아 두는 건물이에요",
  fab: "반도체 공장이에요. 클린룸 사이에 서버룸이 있어요",
  utility: "전기실과 기계실 같은 지원 시설이에요",
  research: "연구동이에요. 서버룸이 있는 연구 시설이에요",
};

const ROOM_HINTS: Readonly<Partial<Record<RoomPurpose, string>>> = {
  network: "회선과 코어 스위치",
  electrical: "수전반과 변압기",
  battery: "UPS 배터리",
  mechanical: "냉동기와 펌프",
  noc: "사람이 지켜보는 곳",
  cleanroom: "반도체 클린룸",
  storage: "부품 보관",
  lobby: "사람과 짐이 드나드는 곳",
};

const OTHER_ROOMS: readonly RoomPurpose[] = [
  "network",
  "electrical",
  "battery",
  "mechanical",
  "noc",
  "cleanroom",
  "storage",
  "lobby",
];

const swatchOf = (c: keyof typeof COLORS) => rgb(COLORS[c]);

function landBundle(view: ToolView): ToolBundle {
  if (view.forSale === 0)
    return { id: "land", title: "땅", picks: [], line: "팔고 있는 땅을 모두 샀어요" };
  return {
    id: "land",
    title: "땅",
    main: { kind: "tool", label: "땅 사기", tool: { kind: "buy" } },
    picks: [],
    line: `팔고 있는 땅이 ${view.forSale}곳 있어요`,
  };
}

function buildingBundle(view: ToolView): ToolBundle {
  const main: BundleMain = {
    kind: "tool",
    label: "건물 올리기",
    tool: { kind: "building", purpose: "data_center" },
  };
  if (view.buildings === 0)
    return { id: "building", title: "건물", main, picks: [], line: "여기엔 아직 건물이 없어요" };
  return {
    id: "building",
    title: "건물",
    main,
    picks: BUILDING_PURPOSES.map((purpose) => ({
      tool: { kind: "building", purpose },
      label: BUILDING_PURPOSE_LABELS[purpose],
      swatch: swatchOf("building"),
      hint: BUILDING_HINTS[purpose],
    })),
  };
}

function siteTools(catalog: Catalog, view: ToolView): ToolBundle[] {
  return [
    landBundle(view),
    buildingBundle(view),
    {
      id: "outside",
      title: "건물 밖 설비",
      main: {
        kind: "tool",
        label: "건물 밖 설비 놓기",
        tool: { kind: "plant", modelId: PLANT_MODELS[0] },
      },
      picks: PLANT_MODELS.map((id) => equipment(catalog, id, swatchOf("cooling"), "plant")),
    },
  ];
}

function powerBundle(catalog: Catalog): ToolBundle {
  return {
    id: "power",
    title: "전기",
    main: {
      kind: "tool",
      label: "전기 설비 놓기",
      tool: { kind: "equipment", modelId: "panel-400a" },
    },
    picks: POWER_MODELS.map((id) =>
      equipment(catalog, id, rgb(id.startsWith("ups") ? COLORS.ups : COLORS.panel)),
    ),
  };
}

function floorTools(catalog: Catalog, view: ToolView): ToolBundle[] {
  const room: BundleMain = {
    kind: "tool",
    label: "서버룸 만들기",
    tool: { kind: "room", purpose: "data_hall" },
  };
  const rooms: ToolBundle =
    view.rooms === 0
      ? { id: "rooms", title: "서버룸", main: room, picks: [], line: "이 층엔 아직 방이 없어요" }
      : {
          id: "rooms",
          title: "방",
          main: room,
          picks: OTHER_ROOMS.map((purpose) => ({
            tool: { kind: "room", purpose },
            label: `${ROOM_WORDS[purpose]} — ${ROOM_HINTS[purpose] ?? ""}`,
            swatch: swatchOf("room"),
            hint: ROOM_HINTS[purpose] ?? "",
          })),
        };
  return [rooms, powerBundle(catalog)];
}

function roomTools(catalog: Catalog, view: ToolView): ToolBundle[] {
  const racks: ToolBundle = view.roomFull
    ? {
        id: "racks",
        title: "랙",
        main: { kind: "widen", label: WIDEN_ROOM },
        picks: [],
        line: "랙 놓을 자리가 없어요",
      }
    : {
        id: "racks",
        title: "랙",
        main: { kind: "tool", label: "랙 놓기", tool: { kind: "rack" } },
        picks: [
          {
            tool: { kind: "containment", aisle: "cold" },
            label: "컨테인먼트 — 냉복도",
            swatch: swatchOf("cold"),
            hint: "랙 줄 사이를 끌어서 덮어요. 안의 랙은 이 복도에 속해요",
          },
          {
            tool: { kind: "containment", aisle: "hot" },
            label: "컨테인먼트 — 열복도",
            swatch: swatchOf("hot"),
            hint: "배기 쪽 복도를 덮어요",
          },
        ],
        note: "컨테인먼트는 랙 줄을 덮는 칸이에요",
      };
  return [
    racks,
    {
      id: "cooling",
      title: "냉방",
      main: {
        kind: "tool",
        label: "냉방기 놓기",
        tool: { kind: "equipment", modelId: COOLING_MODELS[0] },
      },
      picks: COOLING_MODELS.map((id) => equipment(catalog, id, swatchOf("cooling"))),
    },
    powerBundle(catalog),
  ];
}

/** The bundles for a level: site (land, buildings, plant), floor (rooms, power), room (racks, cooling, power). */
export function toolsFor(level: Level, catalog: Catalog, view: ToolView): ToolBundle[] {
  if (level.kind === "site") return siteTools(catalog, view);
  return level.kind === "floor" ? floorTools(catalog, view) : roomTools(catalog, view);
}

/** The line and the words of every bundle at a level: what a test reads to hold them to the style rules. */
export function bundleTexts(bundles: readonly ToolBundle[]): string[] {
  return bundles.flatMap((b) => [
    b.title,
    ...(b.main ? [b.main.label] : []),
    ...(b.line ? [b.line] : []),
    ...(b.note ? [b.note] : []),
    ...b.picks.flatMap((p) => [p.label, p.hint]),
  ]);
}
