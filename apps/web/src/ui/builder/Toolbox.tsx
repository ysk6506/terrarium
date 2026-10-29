/** The left panel: what can be placed on this level, with what it costs, plus how to move around. */
import { RACK_WIDTH_M } from "@terrarium/core/kernel";
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

function toolsFor(level: builder.Level): ToolItem[] {
  if (level.kind === "site")
    return [
      {
        tool: { kind: "building" },
        label: "건물",
        swatch: rgb(C.building),
        hint: "땅 위에 끌어서 건물의 자리를 잡는다 (5 m 단위)",
      },
    ];
  const power = [
    equipment("panel-400a", rgb(C.panel)),
    equipment("panel-225a", rgb(C.panel)),
    equipment("ups-500kva", rgb(C.ups)),
    equipment("ups-200kva", rgb(C.ups)),
  ];
  if (level.kind === "floor")
    return [
      {
        tool: { kind: "room" },
        label: "서버룸",
        swatch: rgb(C.room),
        hint: "건물 안에 끌어서 서버룸을 만든다 (0.6 m 타일 단위)",
      },
      ...power,
    ];
  return [
    {
      tool: { kind: "rack" },
      label: "랙",
      swatch: rgb(C.rackFull),
      hint: `누르면 하나, 끌면 한 줄로 놓는다 (폭 ${RACK_WIDTH_M} m). R로 돌린다`,
    },
    {
      tool: { kind: "containment", aisle: "cold" },
      label: "냉복도 컨테인먼트",
      swatch: rgb(C.cold),
      hint: "랙 줄 사이를 끌어서 감싼다. 안의 랙은 이 복도에 속한다",
    },
    {
      tool: { kind: "containment", aisle: "hot" },
      label: "열복도 컨테인먼트",
      swatch: rgb(C.hot),
      hint: "배기 쪽 복도를 감싼다",
    },
    equipment("crah-100kw", rgb(C.cooling)),
    equipment("inrow-30kw", rgb(C.cooling)),
    ...power,
  ];
}

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["끌기", "화면 이동"],
  ["휠", "확대, 축소"],
  ["Q, E", "돌려 보기"],
  ["R", "돌리기"],
  ["Delete", "지우기"],
  ["Esc", "놓기 그만"],
  ["Ctrl+Z", "되돌리기"],
  ["Ctrl+Shift+Z", "다시 하기"],
];

const same = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);

export function Toolbox({ b }: { readonly b: Builder }) {
  const { level, tool } = b.state;
  const items = toolsFor(level);
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
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="tool"
              title={item.hint}
              aria-pressed={same(tool, item.tool)}
              onClick={() => b.setTool(same(tool, item.tool) ? { kind: "select" } : item.tool)}
            >
              <span className="tool-swatch" style={{ background: item.swatch }} />
              {item.label}
              {item.cost !== undefined && <span className="tool-cost">{won(item.cost)}</span>}
            </button>
          ))}
        </div>
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
        <p style={{ marginTop: 8 }}>건물이나 서버룸을 두 번 누르면 들어간다.</p>
      </div>
    </aside>
  );
}
