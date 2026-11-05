/**
 * Rack names over the plan view of the airflow map (REQ-072). Each follows its rack without re-rendering
 * the page. A name is written along the rack's long side when the rack is narrow on screen, and a name that
 * would not be readable at this zoom is left out, except the picked rack's and the hottest one's.
 */
import { useEffect, useMemo, useRef } from "react";
import type { world3d } from "../../logic";
import type { WorldView } from "./view";

/** The smallest text that still reads, pixels. */
const MIN_FONT_PX = 9;
const MAX_FONT_PX = 12;
/** Names are written for at most this many racks: a hall of thousands is read by zooming in on a part. */
const MAX_LABELS = 700;

interface Props {
  readonly view: WorldView;
  readonly air: world3d.Airflow;
  readonly nameOf: (id: string) => string;
  readonly picked: string | undefined;
}

export function AirLabels({ view, air, nameOf, picked }: Props) {
  const refs = useRef(new Map<string, HTMLSpanElement>());
  const racks = useMemo(() => air.racks.slice(0, MAX_LABELS), [air.racks]);
  const hottest = air.hottest?.id;
  useEffect(() => {
    const dims = new Map(racks.map((r) => [r.id, r]));
    const place = () => {
      const { distance } = view.rig.pose();
      const fov = (view.engine.camera.fov * Math.PI) / 180;
      const pxPerM = view.canvasSize.h / (2 * distance * Math.tan(fov / 2));
      view.forEachAirRack((id, x, y, visible) => {
        const el = refs.current.get(id);
        const r = dims.get(id);
        if (!el || !r) return;
        const wide = (Math.abs(r.fz) * r.w + Math.abs(r.fx) * r.d) * pxPerM;
        const tall = (Math.abs(r.fz) * r.d + Math.abs(r.fx) * r.w) * pxPerM;
        const chars = Math.max(2, el.textContent?.length ?? 3);
        const along = Math.max(wide, tall);
        const across = Math.min(wide, tall);
        const font = Math.min(MAX_FONT_PX, across * 0.78, (along * 0.9) / (chars * 0.62));
        const forced = id === picked || id === hottest;
        const show = visible && (forced || font >= MIN_FONT_PX);
        el.style.visibility = show ? "visible" : "hidden";
        if (!show) return;
        el.style.fontSize = `${Math.max(MIN_FONT_PX, Math.round(font))}px`;
        el.style.writingMode =
          tall > wide * 1.2 && wide < chars * 7 ? "vertical-rl" : "horizontal-tb";
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      });
    };
    place();
    return view.onRender(place);
  }, [view, racks, picked, hottest]);
  return (
    <>
      {racks.map((r) => (
        <span
          key={r.id}
          ref={(el) => {
            if (el) refs.current.set(r.id, el);
            else refs.current.delete(r.id);
          }}
          className={`air-label${r.id === picked ? " air-label-picked" : ""}`}
          style={{ left: 0, top: 0, visibility: "hidden" }}
        >
          {nameOf(r.id)}
        </span>
      ))}
    </>
  );
}
