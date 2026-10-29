/**
 * The block palette (REQ-034): every block the simulator knows, by category. Blocks that cannot be used
 * — not supported yet, or nothing in this world to act on — stay visible, greyed, with the reason.
 * Drag a block onto the canvas, or press it to drop it under the last block.
 */
import { CATEGORY_LABELS, type PaletteItem, paletteFor } from "@terrarium/core/scenario";
import { useMemo, useState } from "react";
import { scenario } from "../../logic";
import type { ScenarioEditor } from "./useScenario";

export const DRAG_TYPE = "application/x-terrarium-block";

function Item({ item, e }: { readonly item: PaletteItem; readonly e: ScenarioEditor }) {
  const add = () => {
    let added: string | undefined;
    const ok = e.change((d) => {
      const r = scenario.addBlock(d, item, scenario.freeSpot(d));
      added = r.nodeId;
      return r.doc;
    });
    if (ok && added) e.select(added);
  };
  return (
    <button
      type="button"
      className="palette-item"
      draggable={item.available}
      aria-disabled={!item.available}
      onDragStart={(ev) => {
        ev.dataTransfer.setData(DRAG_TYPE, item.key);
        ev.dataTransfer.effectAllowed = "copy";
      }}
      onClick={add}
    >
      <span>{item.label}</span>
      <small>{item.available ? item.description : item.reason}</small>
    </button>
  );
}

const GROUP_ORDER = ["flow", "fault", "operation", "agent"] as const;

export function Palette({ e }: { readonly e: ScenarioEditor }) {
  const items = useMemo(() => paletteFor(e.index), [e.index]);
  const [query, setQuery] = useState("");
  const shown = items.filter(
    (i) => !query.trim() || `${i.label} ${i.description}`.includes(query.trim()),
  );
  return (
    <aside className="builder-side" aria-label="블록">
      <div className="builder-block">
        <input
          className="input"
          type="search"
          placeholder="블록 찾기"
          aria-label="블록 찾기"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
        <p className="tiny muted" style={{ marginTop: 8 }}>
          캔버스로 끌어 놓거나 눌러서 더한다. 흐린 블록은 이유를 읽어 본다.
        </p>
      </div>
      {GROUP_ORDER.map((category) => {
        const mine = shown.filter((i) => i.category === category);
        if (mine.length === 0) return null;
        const groups = [...new Set(mine.map((i) => i.group ?? ""))];
        return (
          <div key={category} className="builder-block">
            <h2>{CATEGORY_LABELS[category]}</h2>
            {groups.map((g) => (
              <div key={g || "all"} style={{ marginBottom: 10 }}>
                {g && (
                  <div className="tiny muted" style={{ margin: "4px 0 6px", fontWeight: 600 }}>
                    {g}
                  </div>
                )}
                {mine
                  .filter((i) => (i.group ?? "") === g)
                  .map((i) => (
                    <Item key={i.key} item={i} e={e} />
                  ))}
              </div>
            ))}
          </div>
        );
      })}
    </aside>
  );
}

export const paletteItem = (e: ScenarioEditor, key: string) =>
  paletteFor(e.index).find((i) => i.key === key);
