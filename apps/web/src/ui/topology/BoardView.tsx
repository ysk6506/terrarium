/**
 * The board, drawn (REQ-078, ADR-0084): tiles on isometric bases with a glyph of their kind, a ring and a glow for the
 * state, pipes between them with drops that run the way the supply goes. The picture is an SVG with one sentence for
 * a screen reader; the tiles a person presses are real buttons laid over it at the same places, so they take the
 * keyboard and a name of their own.
 */
import type { Tile } from "@terrarium/core/topology";
import { useId } from "react";
import { hallTopology } from "../../logic";
import { Glyph } from "./glyphs";

const TILE_HALF = hallTopology.TILE_HALF;
const TILE_D = 20;
/** Pipes beyond this many do not run drops: a hundred moving things is noise, not information. */
const RUNNING = 36;
const TEXT_W = 168;

/** A rough width of a line of text at 12 px, to squeeze it into the room a column has. */
function squeeze(text: string): number | undefined {
  const width = [...text].reduce((n, c) => n + (/[가-힣]/.test(c) ? 12 : 6.6), 0);
  return width > TEXT_W ? TEXT_W : undefined;
}

function Slab({ tile, state }: { readonly tile: Tile; readonly state: string }) {
  const w = TILE_HALF * 2;
  const top = `0,${-TILE_D} ${w / 2},0 0,${TILE_D} ${-w / 2},0`;
  const stack = tile.group ? [10, 5] : [];
  return (
    <>
      {stack.map((lift) => (
        <polygon
          key={lift}
          className="slab-top"
          points={`0,${-TILE_D - lift} ${w / 2},${-lift} 0,${TILE_D - lift} ${-w / 2},${-lift}`}
        />
      ))}
      <polygon className="slab-l" points={`${-w / 2},0 0,${TILE_D} 0,${TILE_D + 8} ${-w / 2},8`} />
      <polygon className="slab-r" points={`${w / 2},0 0,${TILE_D} 0,${TILE_D + 8} ${w / 2},8`} />
      <polygon className="slab-top" points={top} />
      {state !== "ok" && state !== "impact" && <polygon className="rim" points={top} />}
    </>
  );
}

function Bar({ tile, y }: { readonly tile: Tile; readonly y: number }) {
  const width = 70;
  let x = -width / 2;
  return (
    <g>
      <rect className="bar-back" x={x} y={y} width={width} height={4} rx={2} />
      {tile.bar.map(([share, state]) => {
        const at = x;
        x += width * share;
        return (
          <rect
            key={state}
            className={`bar-${state}`}
            x={at}
            y={y}
            width={width * share}
            height={4}
            rx={2}
          />
        );
      })}
    </g>
  );
}

/** What the agent's last call looks like on the board: a look is light, a change is dark and rings while it is new. */
export interface Pulse {
  readonly effect: "read" | "write";
  /** Within three seconds of the call: the ring runs. The touched tile keeps its colour until the next call. */
  readonly active: boolean;
}

function TileView({ at, pulse }: { readonly at: hallTopology.Placed; readonly pulse?: Pulse }) {
  const { tile } = at;
  const state = tile.partner
    ? "partner"
    : tile.touched && tile.state === "ok"
      ? "touch"
      : tile.state;
  const kind = tile.touched && pulse ? ` touch-${pulse.effect}` : "";
  const label = 4 + TILE_D + 22;
  return (
    <g className={`topo-tile s-${state}${kind}`} transform={`translate(${at.x},${at.y})`}>
      {tile.focus && (
        <ellipse className="pick" cx={0} cy={4} rx={TILE_HALF + 14} ry={TILE_D + 14} />
      )}
      {state !== "ok" && (
        <ellipse className="glow" cx={0} cy={6} rx={TILE_HALF * 0.82} ry={TILE_D * 0.78} />
      )}
      {tile.touched && pulse?.active && pulse.effect === "write" && (
        <ellipse className="ring" cx={0} cy={2} rx={TILE_HALF * 0.6} ry={TILE_D * 0.6} />
      )}
      <ellipse className="shadow" cx={0} cy={10} rx={TILE_HALF * 0.55} ry={TILE_D * 0.5} />
      <Slab tile={tile} state={state} />
      <g transform="translate(0,-6)">
        <Glyph kind={tile.kind} group={tile.group} state={tile.state} />
      </g>
      <text
        className="lbl"
        y={label}
        textAnchor="middle"
        textLength={squeeze(tile.name)}
        lengthAdjust="spacingAndGlyphs"
      >
        {tile.name}
      </text>
      {tile.line && (
        <text
          className="st"
          y={label + 15}
          textAnchor="middle"
          textLength={squeeze(tile.line)}
          lengthAdjust="spacingAndGlyphs"
        >
          {tile.line}
        </text>
      )}
      <Bar tile={tile} y={label + 21} />
    </g>
  );
}

function PipeView({
  pipe,
  running,
  anchor,
}: {
  readonly pipe: hallTopology.Pipe;
  readonly running: boolean;
  readonly anchor: string;
}) {
  const { edge } = pipe;
  const flowing = edge.live && (edge.kind === "cold" || edge.kind === "hot");
  const dropClass = edge.kind === "hot" ? "drop drop-hot" : "drop";
  return (
    <g>
      <path className="pipe-base" d={pipe.d} strokeWidth={pipe.width + 4} />
      <path
        id={anchor}
        className={`pipe pipe-${edge.live ? edge.kind : "dead"}`}
        d={pipe.d}
        strokeWidth={edge.live ? pipe.width : 2}
      />
      {flowing &&
        running &&
        [0, 1, 2].map((i) => (
          <circle key={i} className={dropClass} r={2.4}>
            <animateMotion dur="2.4s" repeatCount="indefinite" begin={`${-i * 0.8}s`}>
              <mpath href={`#${anchor}`} />
            </animateMotion>
          </circle>
        ))}
      {pipe.label && (
        <text className="cnt" x={pipe.labelX} y={pipe.labelY} textAnchor="middle">
          {pipe.label}
        </text>
      )}
    </g>
  );
}

export interface BoardViewProps {
  readonly layout: hallTopology.Layout;
  readonly picture: string;
  /** Pipes carry drops when true; false for a person who asked for less motion. */
  readonly moving: boolean;
  readonly pulse?: Pulse;
  readonly onPick: (tile: Tile) => void;
}

/** A tile can be pressed when it is one piece of equipment, or a group that opens. */
const pressable = (tile: Tile): boolean => !tile.group || tile.open !== undefined;

export function BoardView({ layout, picture, moving, pulse, onPick }: BoardViewProps) {
  const uid = useId().replace(/:/g, "");
  const { width, height } = layout;
  const hit = { w: TILE_HALF * 2 + 24, h: 116 };
  return (
    <div className="topo-board" style={{ aspectRatio: `${width} / ${height}` }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={picture}>
        {layout.columns.map((c) => (
          <text key={c.label} className="col" x={c.x} y={30} textAnchor="middle">
            {c.label}
          </text>
        ))}
        {layout.pipes.map((p, i) => (
          <PipeView key={p.key} pipe={p} running={moving && i < RUNNING} anchor={`${uid}-p${i}`} />
        ))}
        {layout.tiles.map((t) => (
          <TileView key={t.tile.id} at={t} {...(pulse ? { pulse } : {})} />
        ))}
      </svg>
      <ul className="topo-hits" aria-label="타일">
        {layout.tiles.map(({ tile, x, y }) => (
          <li
            key={tile.id}
            style={{
              left: `${((x - hit.w / 2) / width) * 100}%`,
              top: `${((y - 40) / height) * 100}%`,
              width: `${(hit.w / width) * 100}%`,
              height: `${(hit.h / height) * 100}%`,
            }}
          >
            {pressable(tile) ? (
              <button
                type="button"
                aria-label={hallTopology.tileText(tile)}
                aria-pressed={tile.focus}
                title={tile.group ? hallTopology.TOPO_WORDS.openHint : tile.name}
                onClick={() => onPick(tile)}
              />
            ) : (
              <span className="topo-still" role="img" aria-label={hallTopology.tileText(tile)} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
