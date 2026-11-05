/**
 * The topology view of a world (REQ-078, ADR-0084): what the world leans on, one layer at a time. It is the second
 * eye on the same world: what is picked in the 3D view is lit here, what is pressed here is picked there, and the
 * time bar is the one the airflow map has. It comes down as a bundle of its own when it is first opened.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  fold,
  impactOf,
  isSpace,
  LAYER_IDS,
  LAYER_LABELS,
  type LayerId,
  type Tile,
} from "@terrarium/core/topology";
import type { BlueprintIndex } from "@terrarium/core/world";
import { useMemo, useState } from "react";
import { type builder, hallTopology } from "../../logic";
import { Segmented } from "../fields";
import { useMediaQuery } from "../hooks";
import { BoardView } from "./BoardView";
import { DrawnLine, ImpactBox, Legend, PickedCard, TimeBar } from "./Hud";
import { TOPOLOGY_CSS } from "./style";
import { BOARD_CSS } from "./style-board";

const W = hallTopology.TOPO_WORDS;

export interface TopologyProps {
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  readonly preview: builder.Preview | undefined;
  readonly previewing: boolean;
  /** What the page has picked: the first of it is lit here. */
  readonly selected: readonly string[];
  readonly onSelect: (ids: readonly string[]) => void;
  /** The moment of the run that is shown, shared with the airflow map. */
  readonly at: number | undefined;
  readonly onAt: (i: number) => void;
  readonly onToggleUnit: (id: string) => void;
  /** The containers to open first: where the builder was looking. */
  readonly start: readonly string[];
}

function Crumbs(props: {
  readonly crumbs: readonly { readonly id: string; readonly name: string }[];
  readonly onCut: (id: string | undefined) => void;
}) {
  return (
    <nav className="crumbs topo-crumbs" aria-label={W.path}>
      <button type="button" className="link-button" onClick={() => props.onCut(undefined)}>
        {W.whole}
      </button>
      {props.crumbs.map((c, i) => (
        <span key={c.id}>
          {" "}
          ›{" "}
          {i === props.crumbs.length - 1 ? (
            <span aria-current="location">{c.name}</span>
          ) : (
            <button type="button" className="link-button" onClick={() => props.onCut(c.id)}>
              {c.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

export default function TopologyView(props: TopologyProps) {
  const { index, catalog, preview, selected } = props;
  const [layer, setLayer] = useState<LayerId>("cooling");
  const [path, setPath] = useState<readonly string[]>(props.start);
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
  const source = useMemo(
    () => hallTopology.sourceOf(index, catalog, preview, props.at),
    [index, catalog, preview, props.at],
  );
  const impact = useMemo(() => impactOf(source), [source]);
  const picked = selected[0];
  const board = useMemo(
    () =>
      fold(source, { layer, path, ...(picked ? { focus: { id: picked, hops: 2 } } : {}) }, impact),
    [source, layer, path, picked, impact],
  );
  const layout = useMemo(() => hallTopology.layout(board), [board]);
  const tile = board.tiles.find((t) => t.focus);
  // A group opens a level; a single piece is picked, and the view opens the way down to where it stands.
  const press = (t: Tile) => {
    if (t.group && t.open) return setPath(t.open);
    props.onSelect([t.id]);
    setPath(hallTopology.pathFor(index, t.id));
  };
  const at = preview ? hallTopology.frameOf(preview, props.at) : 0;
  return (
    <div className="topo">
      <style>{TOPOLOGY_CSS + BOARD_CSS}</style>
      <div className="topo-head">
        <Crumbs crumbs={board.path} onCut={(id) => setPath(hallTopology.cutTo(path, id))} />
        <Segmented
          label={W.layers}
          value={layer}
          options={LAYER_IDS.map((id) => ({ value: id, label: LAYER_LABELS[id] }))}
          onChange={setLayer}
        />
      </div>
      <div className="topo-body">
        <div className="topo-scroll">
          {board.tiles.length === 0 ? (
            <p className="topo-empty">{W.none}</p>
          ) : (
            <BoardView
              layout={layout}
              picture={hallTopology.pictureText(board)}
              moving={!calm}
              onPick={press}
            />
          )}
        </div>
        <div className="topo-top">
          <ImpactBox impact={impact} ran={preview !== undefined} />
          <div className="topo-agent-slot" aria-hidden="true" />
          <DrawnLine board={board} />
        </div>
        <div className="topo-foot">
          <Legend />
          {preview && <TimeBar frames={preview.frames} at={at} onAt={props.onAt} />}
          <PickedCard
            tile={tile}
            missing={picked !== undefined && !tile && !isSpace(index, picked)}
            stopped={tile ? (preview?.stopped.has(tile.id) ?? false) : false}
            canStop={tile?.kind === "crah"}
            busy={props.previewing}
            onToggleUnit={() => tile && props.onToggleUnit(tile.id)}
          />
        </div>
      </div>
    </div>
  );
}
