/**
 * The topology view of a world (REQ-078, ADR-0084): what the world leans on, one layer at a time. It is the second
 * eye on the same world: what is picked in the 3D view is lit here, what is pressed here is picked there, and the
 * time bar is the one the airflow map has. It comes down as a bundle of its own when it is first opened.
 */
import {
  fold,
  impactOf,
  isSpace,
  LAYER_IDS,
  LAYER_LABELS,
  type LayerId,
  type Tile,
  type TopologySource,
} from "@terrarium/core/topology";
import type { BlueprintIndex } from "@terrarium/core/world";
import { type ReactNode, useMemo, useState } from "react";
import { hallTopology } from "../../logic";
import { Segmented } from "../fields";
import { useMediaQuery } from "../hooks";
import { AgentBubble, type AgentLook } from "./AgentBubble";
import { BoardView } from "./BoardView";
import { DrawnLine, ImpactBox, Legend, PickedCard } from "./Hud";
import { TOPOLOGY_CSS } from "./style";
import { BOARD_CSS } from "./style-board";

const W = hallTopology.TOPO_WORDS;

/** The one thing the builder can do to a cooling unit from here: stop it to see what follows, or start it again. */
export interface UnitControl {
  readonly stopped: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onToggle: (id: string) => void;
}

export interface TopologyProps {
  readonly index: BlueprintIndex;
  /** The moment to draw: the world as built, a frame of the builder's run, or a moment of a recorded run. */
  readonly source: TopologySource;
  /** Whether anything has run yet (the impact box says so when it has not). */
  readonly ran: boolean;
  /** What the page has picked: the first of it is lit here. */
  readonly selected: readonly string[];
  readonly onSelect: (ids: readonly string[]) => void;
  /** The containers to open first: where the builder was looking. */
  readonly start: readonly string[];
  readonly unit?: UnitControl;
  /** The agent's pulse and speech bubble (runs only). */
  readonly agent?: AgentLook;
  /** The time bar, shared with the other views of the same moment. */
  readonly bar?: ReactNode;
  /** A name over the board, for the side-by-side view. */
  readonly caption?: string;
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
  const { index, source, selected, unit, agent } = props;
  const [layer, setLayer] = useState<LayerId>("cooling");
  const [path, setPath] = useState<readonly string[]>(props.start);
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
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
  return (
    <div className="topo">
      {props.caption && <p className="topo-caption">{props.caption}</p>}
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
              {...(agent ? { pulse: { effect: agent.effect, active: agent.active } } : {})}
              onPick={press}
            />
          )}
        </div>
        <div className="topo-top">
          <ImpactBox impact={impact} ran={props.ran} />
          <div className="topo-agent-slot">{agent && <AgentBubble look={agent} />}</div>
          <DrawnLine board={board} />
        </div>
        <div className="topo-foot">
          <Legend />
          {props.bar}
          <PickedCard
            tile={tile}
            missing={picked !== undefined && !tile && !isSpace(index, picked)}
            stopped={tile ? (unit?.stopped.has(tile.id) ?? false) : false}
            canStop={unit !== undefined && tile?.kind === "crah"}
            busy={unit?.busy ?? false}
            onToggleUnit={() => tile && unit?.onToggle(tile.id)}
          />
        </div>
      </div>
    </div>
  );
}
