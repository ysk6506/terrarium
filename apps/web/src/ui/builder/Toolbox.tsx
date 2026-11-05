/** The left panel: what can be placed on this level, with what it costs, plus how to move around. */
import { RACK_WIDTH_M } from "@terrarium/core/kernel";
import {
  BUILD_RATE_M_PER_M2,
  BUILDING_PURPOSE_LABELS,
  type BuildingPurpose,
  CONTAINMENT_RATE_M_PER_M2,
  FIT_OUT_RATE_M_PER_M2,
  type RoomPurpose,
} from "@terrarium/core/world";
import { builder, won } from "../../logic";
import type { Builder, Tool } from "./useBuilder";
import { catalog } from "./useBuilder";

const rgb = (c: readonly [number, number, number]) =>
  `rgb(${c.map((v) => Math.round(v * 255)).join(" ")})`;

interface ToolItem {
  readonly tool: Tool;
  readonly label: string;
  readonly swatch: string;
  readonly hint: string;
  readonly cost?: number;
  /** A price per square metre, for things whose cost grows with their size. */
  readonly rate?: number;
}

const C = builder.COLORS;

function equipment(modelId: string, swatch: string): ToolItem {
  const model = catalog.get(modelId);
  const footprint = "footprint" in model ? model.footprint : undefined;
  return {
    tool: { kind: "equipment", modelId },
    label: model.name,
    swatch,
    hint: `${model.description}${footprint ? ` (${footprint.w}×${footprint.d} m)` : ""}`,
    cost: model.costM,
  };
}

interface ToolGroup {
  readonly title: string;
  readonly items: readonly ToolItem[];
}

const BUILDING_SWATCH = rgb(C.building);

function building(purpose: BuildingPurpose, hint: string): ToolItem {
  return {
    tool: { kind: "building", purpose },
    label: BUILDING_PURPOSE_LABELS[purpose],
    swatch: BUILDING_SWATCH,
    hint,
    rate: BUILD_RATE_M_PER_M2[purpose],
  };
}

function room(purpose: RoomPurpose, hint: string): ToolItem {
  return {
    tool: { kind: "room", purpose },
    label: purpose === "data_hall" ? "서버룸" : builder.ROOM_WORDS[purpose],
    swatch: rgb(C.room),
    hint,
    rate: FIT_OUT_RATE_M_PER_M2[purpose],
  };
}

function plant(modelId: string): ToolItem {
  const model = catalog.get(modelId);
  return {
    tool: { kind: "plant", modelId },
    label: model.name,
    swatch: rgb(C.cooling),
    hint: `${model.description} 건물 옆 내 땅에 놓아요`,
    cost: model.costM,
  };
}

const POWER = ["panel-400a", "panel-225a", "ups-500kva", "ups-200kva"] as const;

function siteTools(): ToolGroup[] {
  return [
    {
      title: "땅",
      items: [
        {
          tool: { kind: "buy" },
          label: "땅 사기",
          swatch: "repeating-linear-gradient(45deg, #ff5a1f 0 3px, transparent 3px 6px)",
          hint: "줄무늬가 있는 팔 땅을 눌러서 사요. 산 땅에만 건물을 지을 수 있어요",
        },
      ],
    },
    {
      title: "건물",
      items: [
        building("data_center", "내 땅 위를 끌어서 데이터센터 건물의 자리를 잡아요 (5 m 단위)"),
        building("fab", "반도체 팹 건물이에요. 팹 안에는 클린룸과 서버룸이 함께 있어요"),
        building("utility", "전기실, 기계실 같은 지원 시설을 두는 유틸리티동이에요"),
        building("research", "연구동이에요. 서버룸이 있는 연구 시설을 만들어요"),
      ],
    },
    {
      title: "건물 밖 설비",
      items: [
        plant("sy-transformer-2500kva"),
        plant("tg-diesel-2mw"),
        plant("gl-chiller-screw-2mw"),
        plant("gl-drycooler-2mw"),
      ],
    },
  ];
}

function floorTools(): ToolGroup[] {
  return [
    {
      title: "방",
      items: [
        room("data_hall", "건물 안에 끌어서 서버룸을 만들어요 (0.6 m 타일 단위)"),
        room("network", "통신사 회선과 코어 스위치가 들어오는 방이에요"),
        room("electrical", "수전반과 변압기가 있는 전기실이에요"),
        room("battery", "UPS 배터리를 두는 배터리실이에요"),
        room("mechanical", "냉동기와 펌프가 있는 기계실이에요"),
        room("noc", "사람이 모니터링하는 관제실이에요"),
        room("cleanroom", "반도체 팹의 클린룸이에요"),
        room("storage", "부품과 장비를 쌓아 두는 창고예요"),
        room("lobby", "사람과 짐이 드나드는 로비와 하역장이에요"),
      ],
    },
    {
      title: "전원",
      items: POWER.map((id) => equipment(id, rgb(id.startsWith("ups") ? C.ups : C.panel))),
    },
  ];
}

function roomTools(): ToolGroup[] {
  return [
    {
      title: "랙과 복도",
      items: [
        {
          tool: { kind: "rack" },
          label: "랙",
          swatch: rgb(C.rackFull),
          hint: `누르면 하나, 끌면 한 줄로 놓아요 (폭 ${RACK_WIDTH_M} m). R로 돌려요`,
        },
        {
          tool: { kind: "containment", aisle: "cold" },
          label: "냉복도 컨테인먼트",
          swatch: rgb(C.cold),
          rate: CONTAINMENT_RATE_M_PER_M2,
          hint: "랙 줄 사이를 끌어서 감싸요. 안의 랙은 이 복도에 속해요",
        },
        {
          tool: { kind: "containment", aisle: "hot" },
          label: "열복도 컨테인먼트",
          swatch: rgb(C.hot),
          rate: CONTAINMENT_RATE_M_PER_M2,
          hint: "배기 쪽 복도를 감싸요",
        },
      ],
    },
    {
      title: "냉방과 전원",
      items: [
        equipment("crah-100kw", rgb(C.cooling)),
        equipment("inrow-30kw", rgb(C.cooling)),
        ...POWER.map((id) => equipment(id, rgb(id.startsWith("ups") ? C.ups : C.panel))),
      ],
    },
  ];
}

function toolsFor(level: builder.Level): ToolGroup[] {
  if (level.kind === "site") return siteTools();
  return level.kind === "floor" ? floorTools() : roomTools();
}

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["끌기", "돌려 보기"],
  ["Shift+끌기", "화면 이동"],
  ["휠", "확대, 축소"],
  ["Q, E", "45도씩 돌리기"],
  ["R", "돌리기"],
  ["Delete", "지우기"],
  ["Esc", "놓기 멈추기"],
  ["Ctrl+Z", "되돌리기"],
  ["Ctrl+Shift+Z", "다시 하기"],
];

const same = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);

function ToolButton({ item, b }: { readonly item: ToolItem; readonly b: Builder }) {
  const { tool } = b.state;
  return (
    <button
      type="button"
      className="tool"
      title={item.hint}
      aria-pressed={same(tool, item.tool)}
      onClick={() => b.setTool(same(tool, item.tool) ? { kind: "select" } : item.tool)}
    >
      <span className="tool-swatch" style={{ background: item.swatch }} />
      {item.label}
      {item.cost !== undefined && <span className="tool-cost">{won(item.cost)}</span>}
      {item.rate !== undefined && <span className="tool-cost">㎡당 {won(item.rate)}</span>}
    </button>
  );
}

export function Toolbox({ b }: { readonly b: Builder }) {
  const { level, tool } = b.state;
  const groups = toolsFor(level);
  return (
    <aside className="builder-side" aria-label="놓을 것">
      <div className="builder-block">
        <h2>놓을 것</h2>
        <div className="stack" style={{ gap: 2 }}>
          <button
            type="button"
            className="tool"
            aria-pressed={tool.kind === "select"}
            onClick={() => b.setTool({ kind: "select" })}
          >
            <span
              className="tool-swatch"
              style={{ background: "transparent", borderStyle: "dashed" }}
            />
            고르고 옮기기
          </button>
        </div>
        {groups.map((g) => (
          <div key={g.title} className="stack" style={{ gap: 2, marginTop: 10 }}>
            <h3 className="tool-group">{g.title}</h3>
            {g.items.map((item) => (
              <ToolButton key={item.label} item={item} b={b} />
            ))}
          </div>
        ))}
      </div>
      <div className="builder-block tiny muted">
        <h2>조작</h2>
        <dl className="keys">
          {KEYS.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p style={{ marginTop: 8 }}>건물이나 서버룸을 두 번 누르면 들어가요.</p>
      </div>
    </aside>
  );
}
