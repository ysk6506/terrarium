/**
 * Names on the runs at work (REQ-050): each marker in the 3D picture carries a chip with the agent and
 * its model, following the marker as the camera moves. Only the runs that did something most recently
 * are named, so a crowd stays readable; the rest are dots, and the panel lists them all.
 */
import { useEffect, useMemo, useRef } from "react";
import { type ActivityState, nameOf, type world3d } from "../../logic";
import type { WorldView } from "./view";

const NAMED = 10;
const POLE_PX = 46;
const PILE_PX = 20;

interface Rect {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

const GAP_PX = 2;

/** Lift a chip until it stands clear of the chips already placed, so names do not pile on one another. */
function clear(taken: Rect[], x: number, y: number, el: HTMLElement): number {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let top = y;
  const box = (): Rect => ({ x0: x - w / 2, x1: x + w / 2, y0: top - h, y1: top });
  const hit = (r: Rect) =>
    taken.find((t) => r.x0 < t.x1 && r.x1 > t.x0 && r.y0 < t.y1 && r.y1 > t.y0);
  for (let i = 0; i < taken.length + 1; i++) {
    const other = hit(box());
    if (!other) break;
    top = other.y0 - GAP_PX;
  }
  taken.push(box());
  return top;
}

export function ActivityPins({
  view,
  markers,
  activity,
  onPick,
}: {
  readonly view: WorldView;
  readonly markers: readonly world3d.Marker[];
  readonly activity: ActivityState;
  readonly onPick: (runId: string) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const named = useMemo(
    () =>
      new Set(
        [...markers]
          .sort((a, b) => b.lastAt - a.lastAt)
          .slice(0, NAMED)
          .map((m) => m.runId),
      ),
    [markers],
  );
  useEffect(() => {
    const place = () => {
      const taken: Rect[] = [];
      const order = [...markers].sort((x, y) => y.lastAt - x.lastAt);
      for (const m of order) {
        const el = refs.current.get(m.runId);
        if (!el) continue;
        const at = view.screenOfSpot(m.at, POLE_PX + m.pile * PILE_PX + 6);
        el.style.visibility = at.visible ? "visible" : "hidden";
        const y = named.has(m.runId) ? clear(taken, at.x, at.y, el) : at.y;
        el.style.transform = `translate(${at.x}px, ${y}px) translate(-50%, -100%)`;
      }
    };
    place();
    return view.onRender(place);
  }, [view, markers, named]);
  return (
    <>
      {markers.map((m) => {
        const worker = activity.workers.find((w) => w.runId === m.runId);
        if (!worker) return null;
        const name = nameOf(worker.who);
        return (
          <button
            key={m.runId}
            type="button"
            ref={(el) => {
              if (el) refs.current.set(m.runId, el);
              else refs.current.delete(m.runId);
            }}
            className={`run-chip${named.has(m.runId) ? "" : " run-chip-dot"}`}
            style={{
              left: 0,
              top: 0,
              visibility: "hidden",
              ["--run" as string]: `var(--run-${m.hue})`,
            }}
            title={`${name.title}\n${name.detail}`}
            aria-label={`${name.title}, ${name.detail}`}
            onClick={() => onPick(m.runId)}
          >
            <span className="run-dot" aria-hidden="true" />
            {named.has(m.runId) && <span className="run-name">{name.title}</span>}
          </button>
        );
      })}
    </>
  );
}
