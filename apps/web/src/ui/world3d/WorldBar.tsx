/** The bar over a stage that is being looked around in: where you are, the layer shown, the little visitors. */
import type { BlueprintIndex } from "@terrarium/core/world";
import { world3d } from "../../logic";
import { Segmented } from "../fields";
import type { Aisle, WorldView } from "./view";

export function WorldBar({
  view,
  index,
  focus,
  aisle,
  layer,
  onLayer,
  life,
  onLife,
}: {
  readonly view: WorldView;
  readonly index: BlueprintIndex;
  readonly focus: world3d.Focus;
  readonly aisle?: Aisle;
  readonly layer: world3d.Layer;
  readonly onLayer: (layer: world3d.Layer) => void;
  readonly life: boolean;
  readonly onLife: (on: boolean) => void;
}) {
  const crumbs = world3d.crumbsOf(index, focus, aisle?.name);
  return (
    <div className="stage-top">
      <nav className="crumbs stage-bar" aria-label="보고 있는 곳">
        {crumbs.map((c, i) =>
          i === crumbs.length - 1 ? (
            <span key={c.label} aria-current="location">
              {c.label}
            </span>
          ) : (
            <span key={c.label}>
              <button type="button" className="link-button" onClick={() => view.focusOn(c.focus)}>
                {c.label}
              </button>{" "}
              ›
            </span>
          ),
        )}
      </nav>
      <div className="stage-bar row">
        <Segmented
          label="보는 층"
          value={layer}
          options={world3d.LAYERS.map((l) => ({ value: l.id, label: l.label }))}
          onChange={onLayer}
        />
        <label className="row tiny">
          <input type="checkbox" checked={life} onChange={(e) => onLife(e.target.checked)} />
          사람과 차
        </label>
      </div>
    </div>
  );
}
