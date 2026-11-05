/** Names over things on the builder's plan: each follows its place in the picture without re-rendering. */
import { useEffect, useRef } from "react";
import type { builder } from "../../logic";
import type { WorldView } from "./view";

export function PlanLabels({
  view,
  labels,
}: {
  readonly view: WorldView;
  readonly labels: readonly builder.SceneLabel[];
}) {
  const refs = useRef(new Map<string, HTMLSpanElement>());
  useEffect(() => {
    const place = () => {
      for (const l of labels) {
        const el = refs.current.get(l.id);
        const at = view.screenOf(l);
        if (!el) continue;
        el.style.visibility = at?.visible ? "visible" : "hidden";
        if (at) el.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
      }
    };
    place();
    return view.onRender(place);
  }, [view, labels]);
  return (
    <>
      {labels.map((l) => (
        <span
          key={l.id}
          ref={(el) => {
            if (el) refs.current.set(l.id, el);
            else refs.current.delete(l.id);
          }}
          className="stage-label"
          style={{ left: 0, top: 0, visibility: "hidden" }}
        >
          {l.text}
        </span>
      ))}
    </>
  );
}
