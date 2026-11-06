/**
 * The glass cards over the board (REQ-078, ADR-0084): the impact range and how soon it turns serious, how much of
 * the world is drawn, the colours' meaning, the picked equipment with its one action, and the time bar of the run.
 * The agent's pulse and speech bubble (step 2) will sit in `topo-agent-slot`, which is empty for now.
 */
import {
  type Board,
  type Impact,
  impactCounts,
  impactServices,
  impactWhen,
  type Tile,
} from "@terrarium/core/topology";
import type { builder } from "../../logic";
import { hallTopology, world3d } from "../../logic";
import { Button } from "../kit";

const W = hallTopology.TOPO_WORDS;

export function ImpactBox({ impact, ran }: { readonly impact: Impact; readonly ran: boolean }) {
  const when = impactWhen(impact);
  const services = impactServices(impact);
  const none =
    impact.racks.size === 0 && impact.rooms.size === 0 && impact.servers === 0 && services === "";
  return (
    <section className="topo-card topo-impact" aria-label={W.impact}>
      <div className="t">{W.impact}</div>
      {none ? (
        <div className="n topo-none">{ran ? W.noImpact : W.notRun}</div>
      ) : (
        <>
          {services && <div className="n">{services}</div>}
          {impact.racks.size + impact.rooms.size + impact.servers > 0 && (
            <div className="n">{impactCounts(impact)}</div>
          )}
          {when && <div className="w">{when}</div>}
        </>
      )}
    </section>
  );
}

export function DrawnLine({ board }: { readonly board: Board }) {
  return <p className="topo-card topo-drawn">{hallTopology.drawnText(board)}</p>;
}

export function Legend() {
  return (
    <ul className="topo-card topo-legend" aria-label={W.legend}>
      <li>
        <i className="dot-fault" />
        {W.fault}
      </li>
      <li>
        <i className="dot-alarm" />
        {W.alarm}
      </li>
      <li>
        <i className="dot-touch" />
        {W.touch}
      </li>
      <li>
        <i className="dot-impact" />
        {W.range}
      </li>
    </ul>
  );
}

/** The picked equipment, how it is doing, and (for a cooling unit) the one thing the builder can do to it. */
export function PickedCard(props: {
  readonly tile: Tile | undefined;
  readonly missing: boolean;
  readonly stopped: boolean;
  readonly canStop: boolean;
  readonly busy: boolean;
  readonly onToggleUnit: () => void;
}) {
  const { tile } = props;
  if (!tile && !props.missing) return null;
  return (
    <section className="topo-card topo-picked" aria-label={W.selected}>
      {tile ? (
        <>
          <b>{tile.name}</b>
          {tile.line && <span>{tile.line}</span>}
        </>
      ) : (
        <span>{W.notHere}</span>
      )}
      {tile && props.canStop && (
        <Button kind="plain" busy={props.busy} onClick={props.onToggleUnit}>
          {props.stopped ? W.start : W.stop}
        </Button>
      )}
    </section>
  );
}

/** The time bar of the "돌려 보기" run: the same one the airflow map has, so both show the same moment. */
export function TimeBar(props: {
  readonly frames: builder.Preview["frames"];
  readonly at: number;
  readonly onAt: (i: number) => void;
}) {
  const { frames, at } = props;
  const last = frames.length - 1;
  if (last < 1) return null;
  return (
    <label className="topo-card topo-time">
      <span>{W.time}</span>
      <input
        type="range"
        min={0}
        max={last}
        value={at}
        aria-label={W.scrub}
        aria-valuetext={world3d.frameText(frames[at]?.t ?? 0)}
        onChange={(e) => props.onAt(Number(e.target.value))}
      />
      <output>{world3d.frameText(frames[at]?.t ?? 0)}</output>
    </label>
  );
}
