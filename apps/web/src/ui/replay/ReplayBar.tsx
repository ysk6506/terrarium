/**
 * The time bar (REQ-078 step 2, ADR-0084 item 8): one bar for the run page, the result page, the side-by-side view and
 * the builder's "돌려 보기". It plays, pauses, is dragged, and takes the keyboard (← → move 5 seconds, Home and End go
 * to the ends). The marks on it are the five things a run does (fault, alarm, look, act, recovery), each at its first
 * time, with a small dot for every time after; a mark's label under the line goes to that moment when pressed.
 */
import type { Mark } from "@terrarium/core/topology";
import { clockText, MARK_LABELS } from "@terrarium/core/topology";
import type { KeyboardEvent, PointerEvent } from "react";
import { useRef } from "react";
import { hallTopology } from "../../logic";
import { SIGNAL_CSS } from "../signal-colors";
import { REPLAY_CSS } from "./style";

const W = hallTopology.TOPO_WORDS;
/** A drag lands on a mark when it is within this share of the line. */
const SNAP = 1.2;

export interface ReplayBarProps {
  /** Seconds into the run, and how long the run is. */
  readonly t: number;
  readonly duration: number;
  readonly marks?: readonly Mark[];
  /** An operation's incidents: a bar from each fault to its end, red while it is still open. */
  readonly bars?: readonly hallTopology.Bar[];
  readonly playing: boolean;
  readonly onPlaying: (playing: boolean) => void;
  readonly onT: (t: number) => void;
  readonly speed: number;
  readonly onSpeed?: (speed: number) => void;
  /** Seconds an arrow key moves the bar (the builder's run moves by its frames). */
  readonly step?: number;
  /** What the slider is called for a screen reader. */
  readonly label?: string;
}

function PlayIcon({ playing }: { readonly playing: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {playing ? (
        <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
      ) : (
        <path d="M5 3l8 5-8 5z" fill="currentColor" />
      )}
    </svg>
  );
}

function Marks({
  marks,
  duration,
}: {
  readonly marks: readonly Mark[];
  readonly duration: number;
}) {
  return (
    <>
      {marks.flatMap((m) =>
        m.at.map((at, i) => (
          <i
            key={`${m.kind}-${at}`}
            className={`rb-mark m-${m.kind}${i === 0 ? "" : " again"}`}
            style={{ left: `${hallTopology.pct(at, duration)}%` }}
          />
        )),
      )}
    </>
  );
}

/** The line itself: the slider a pointer drags and the keyboard moves. */
function Track(props: ReplayBarProps) {
  const { t, duration, marks = [], step } = props;
  const track = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return;
    const ratio = hallTopology.ratioOf(e.clientX, box.left, box.width);
    const near = marks.find((m) => Math.abs(hallTopology.pct(m.t, duration) - ratio * 100) < SNAP);
    props.onT(near ? near.t : ratio * duration);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = hallTopology.keyedT(e.key, t, duration, step);
    if (next === undefined) return;
    e.preventDefault();
    props.onT(next);
  };
  return (
    <div
      ref={track}
      className="rb-track"
      role="slider"
      tabIndex={0}
      aria-label={props.label ?? W.scrub}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t)}
      aria-valuetext={hallTopology.valueText(t, duration)}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && move(e)}
    >
      <i className="rb-line" />
      <i className="rb-fill" style={{ width: `${hallTopology.pct(t, duration)}%` }} />
      {props.bars?.map((b) => (
        <i
          key={`${b.target}-${b.from}`}
          className={`rb-span${b.open ? " open" : ""}`}
          style={{
            left: `${hallTopology.pct(b.from, duration)}%`,
            width: `${Math.max(0.6, hallTopology.pct(b.to, duration) - hallTopology.pct(b.from, duration))}%`,
          }}
        />
      ))}
      <Marks marks={marks} duration={duration} />
      <i className="rb-knob" style={{ left: `${hallTopology.pct(t, duration)}%` }} />
    </div>
  );
}

export function ReplayBar(props: ReplayBarProps) {
  const { t, duration, marks = [], playing } = props;
  const toggle = () => {
    // Pressing play at the very end starts over.
    if (!playing && t >= duration) props.onT(0);
    props.onPlaying(!playing);
  };
  return (
    <div className="rb">
      <style>{SIGNAL_CSS + REPLAY_CSS}</style>
      <button
        type="button"
        className="rb-play"
        aria-label={playing ? W.pause : W.play}
        aria-pressed={playing}
        onClick={toggle}
      >
        <PlayIcon playing={playing} />
      </button>
      <Track {...props} />
      <output className="rb-value" aria-hidden="true">
        {hallTopology.valueText(t, duration)}
      </output>
      <div className="rb-ticks">
        {hallTopology.ticks(marks, duration).map(({ mark, at, row }) => (
          <button
            key={mark.kind}
            type="button"
            className={`rb-tick t-${mark.kind} row-${row}`}
            style={{ left: `${at}%` }}
            onClick={() => props.onT(mark.t)}
          >
            {mark.label ?? MARK_LABELS[mark.kind]} {clockText(mark.t)}
          </button>
        ))}
      </div>
      {props.onSpeed && (
        <label className="rb-speed">
          <span className="sr-only">{W.speed}</span>
          <select
            value={props.speed}
            onChange={(e) => props.onSpeed?.(Number(e.target.value))}
            aria-label={W.speed}
          >
            {hallTopology.SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}배속
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
