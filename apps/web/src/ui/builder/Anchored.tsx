/**
 * The one anchoring system of the builder (REQ-109, ADR-0132): a card over the 3D view opens where its anchor is, never
 * outside the stage, never wider than `min(320px, 100vw - 32px)`; under 900 px it is a sheet at the foot. The "놓기"
 * sheet anchors under its button; the card of what is picked anchors beside the thing in the picture and follows it as
 * the camera moves. The rule itself is `builder.placeCard`; this only measures and places.
 */
import { type ReactNode, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { builder } from "../../logic";

type Placement = builder.Placement;

const same = (a: Placement | undefined, b: Placement): boolean =>
  a !== undefined && a.left === b.left && a.top === b.top && a.sheet === b.sheet;

/** Measure the card and its stage, and place the card; again whenever either changes size. */
function usePlacement(
  anchor: builder.StagePoint | undefined,
  mode: "beside" | "below",
): { ref: React.RefObject<HTMLDivElement | null>; at: Placement | undefined } {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<Placement>();
  const x = anchor?.x;
  const y = anchor?.y;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the anchor is read by its two numbers so a new object of the same place does not measure again
  useLayoutEffect(() => {
    const el = ref.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    const measure = () => {
      const s = stage.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      const next = builder.placeCard({
        anchor: x === undefined || y === undefined ? undefined : { x, y },
        stage: { w: s.width, h: s.height },
        card: { w: c.width, h: c.height },
        viewport: window.innerWidth,
        mode,
      });
      setAt((prev) => (same(prev, next) ? prev : next));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    watch.observe(stage);
    return () => watch.disconnect();
  }, [x, y, mode]);
  return { ref, at };
}

export function Anchored(props: {
  readonly anchor: builder.StagePoint | undefined;
  readonly mode?: "beside" | "below";
  readonly children: ReactNode;
  readonly name: string;
}) {
  const { ref, at } = usePlacement(props.anchor, props.mode ?? "beside");
  return (
    <div
      ref={ref}
      className={`anchored${at?.sheet ? " sheet" : ""}`}
      data-anchored={props.name}
      style={{
        visibility: at ? "visible" : "hidden",
        // a sheet takes its place from the stylesheet; before the first measure the card waits at the corner, unseen
        ...(at ? (at.sheet ? {} : { left: at.left, top: at.top }) : { left: 0, top: 0 }),
      }}
    >
      {props.children}
    </div>
  );
}

/** The place of the picked thing, which moves with the camera. */
export function usePickAnchor(store: builder.AnchorStore): builder.StagePoint | undefined {
  return useSyncExternalStore(store.subscribe, store.get);
}
