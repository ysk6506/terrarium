/**
 * The left panel, "여기서 할 일" (REQ-077, ADR-0083): only what can be put down where the person is, in bundles with
 * one big button each and a list named by what things are for. Keys are behind "조작법", not on the page.
 */
import { builder } from "../../logic";
import type { Builder, Tool } from "./useBuilder";
import { catalog } from "./useBuilder";
import { widenRoom } from "./widen";

const same = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ["끌기", "화면 돌리기"],
  ["Shift+끌기", "화면 이동"],
  ["휠", "확대, 축소"],
  ["Q, E", "45도씩 돌리기"],
  ["R", "놓을 것 돌리기"],
  ["Delete", "지우기"],
  ["Esc", "놓기 멈추기"],
  ["Ctrl+Z", "되돌리기"],
  ["Ctrl+Shift+Z", "다시 하기"],
];

const PLACE: Readonly<Record<builder.Level["kind"], string>> = {
  site: "사업장에서 할 일",
  floor: "이 층에서 할 일",
  room: "이 서버룸에서 할 일",
};

/** What is at this level that decides which bundles say a line. */
export function viewOf(b: Builder): builder.ToolView {
  const { index, level, blueprint } = b.state;
  return {
    buildings: index.ofKind("building").length,
    forSale: builder.parcelViews(index, catalog).filter((p) => !p.owned).length,
    rooms: level.kind === "floor" ? index.childrenOf(level.id, "room").length : 0,
    roomFull: level.kind === "room" && builder.roomFull(blueprint, catalog, level.id),
  };
}

function BigButton({ main, b }: { readonly main: builder.BundleMain; readonly b: Builder }) {
  const { tool } = b.state;
  if (main.kind === "widen")
    return (
      <button type="button" className="btn btn-big" onClick={() => widenRoom(b)}>
        {main.label}
      </button>
    );
  const held = same(tool, main.tool);
  return (
    <button
      type="button"
      className="btn btn-big"
      aria-pressed={held}
      onClick={() => b.setTool(held ? { kind: "select" } : main.tool)}
    >
      {main.label}
    </button>
  );
}

function PickButton({ pick, b }: { readonly pick: builder.ToolPick; readonly b: Builder }) {
  const held = same(b.state.tool, pick.tool);
  return (
    <button
      type="button"
      className="tool"
      title={pick.hint}
      aria-pressed={held}
      onClick={() => b.setTool(held ? { kind: "select" } : pick.tool)}
    >
      <span className="tool-swatch" style={{ background: pick.swatch }} />
      {pick.label}
    </button>
  );
}

function Bundle({ bundle, b }: { readonly bundle: builder.ToolBundle; readonly b: Builder }) {
  return (
    <section className="bundle" aria-label={bundle.title}>
      <h3 className="tool-group">{bundle.title}</h3>
      {bundle.line && <p className="small">{bundle.line}</p>}
      {bundle.main && <BigButton main={bundle.main} b={b} />}
      {bundle.picks.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {bundle.picks.map((p) => (
            <PickButton key={p.label} pick={p} b={b} />
          ))}
        </div>
      )}
      {bundle.note && <p className="tiny muted">{bundle.note}</p>}
    </section>
  );
}

function Keys() {
  return (
    <details className="keys-help">
      <summary>조작법 ?</summary>
      <dl className="keys tiny">
        {KEYS.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="tiny muted">건물이나 서버룸을 두 번 누르면 들어가요.</p>
    </details>
  );
}

export function Toolbox({ b }: { readonly b: Builder }) {
  const { level, tool } = b.state;
  const bundles = builder.toolsFor(level, catalog, viewOf(b));
  return (
    <aside className="builder-side" aria-label="여기서 할 일">
      <div className="builder-block stack">
        <h2>{PLACE[level.kind]}</h2>
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
        {bundles.map((bundle) => (
          <Bundle key={bundle.id} bundle={bundle} b={b} />
        ))}
      </div>
      <div className="builder-block">
        <Keys />
      </div>
    </aside>
  );
}
