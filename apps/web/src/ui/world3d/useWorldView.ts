/**
 * The hooks behind the 3D stage: the view that lives as long as its canvas, what it is told about the
 * world, and how pointer events on it become the builder's events. Kept out of the component so each
 * part stays small and the component is only layout.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex } from "@terrarium/core/world";
import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from "react";
import { type builder, world3d } from "../../logic";
import type { DragTool } from "./rig";
import type { Ghost, PlanPoint, StageEvents } from "./stage-types";
import { WorldView } from "./view";

/** The view behind a canvas: made when the canvas is there, sized with its box, let go of on leaving. */
export function useWorldView(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  hostRef: RefObject<HTMLElement | null>,
): { readonly view: WorldView | undefined; readonly failed: boolean } {
  const [view, setView] = useState<WorldView>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    let made: WorldView;
    try {
      made = new WorldView(canvas, host);
    } catch {
      setFailed(true);
      return;
    }
    setView(made);
    const observer = new ResizeObserver(() => made.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      made.dispose();
      setView(undefined);
    };
  }, [canvasRef, hostRef]);
  return { view, failed };
}

export interface Content {
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  readonly level?: builder.Level;
  /** Back the camera out to the whole land at the site level. */
  readonly wide?: boolean;
  readonly scene?: builder.Scene;
  readonly selected?: readonly string[];
  readonly ghost?: Ghost;
  /** The handles of the selected room or building, where they sit on the plan. */
  readonly handles?: readonly world3d.PlanHandle[];
  readonly layer: world3d.Layer;
  readonly overlay?: world3d.Overlay;
}

/** Keep the view in step with the world and with what the builder shows over it. */
export function useWorldContent(view: WorldView | undefined, c: Content): void {
  const loaded = useRef(false);
  const placed = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new world is loaded; the level has its own effect
  useEffect(() => {
    if (!view) return;
    view.navigate = c.level === undefined;
    view.load(c.index, c.catalog, loaded.current);
    loaded.current = true;
  }, [view, c.index, c.catalog]);
  useEffect(() => {
    if (!view || !c.level) return;
    view.setLevel(c.level, placed.current, c.wide);
    placed.current = true;
  }, [view, c.level, c.wide]);
  useEffect(() => {
    if (!view) return;
    view.showLayer(c.layer, c.overlay ?? {});
  }, [view, c.layer, c.overlay]);
  useEffect(() => {
    view?.setSelection(c.scene && c.selected ? world3d.outlinesOf(c.scene, c.selected) : []);
    view?.overlay.setShapes(c.scene && c.selected ? world3d.shapesOf(c.scene, c.selected) : []);
  }, [view, c.scene, c.selected]);
  useEffect(() => {
    view?.overlay.setHandles(c.handles ?? []);
  }, [view, c.handles]);
  useEffect(() => {
    view?.setGhost(c.ghost ? { ...world3d.ghostBox(c.ghost), ok: c.ghost.ok } : undefined);
  }, [view, c.ghost]);
}

/** The newest props, readable from handlers that were made once. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

interface Drag {
  readonly from: PlanPoint;
  readonly hit: string | undefined;
  to: PlanPoint;
}

/** What is under a pixel, if it is a thing of the world the builder knows. */
function hitAt(view: WorldView, index: BlueprintIndex, x: number, y: number): string | undefined {
  const tag = view.pickAt(x, y);
  return tag && index.find(tag.id) ? tag.id : undefined;
}

/** A drag the builder may take: the tool is asked once the pointer has really moved. */
function dragTool(
  view: WorldView,
  props: MutableRefObject<
    StageEvents & { readonly index: BlueprintIndex; readonly readOnly?: boolean }
  >,
): DragTool {
  let drag: Drag | undefined;
  const finish = (x: number, y: number) => {
    const d = drag;
    drag = undefined;
    const to = view.planPointAt(x, y) ?? d?.to;
    if (d && to) props.current.onDrag?.("end", d.from, to, d.hit);
  };
  return {
    start(x, y) {
      const p = props.current;
      if (view.crew.hit(x, y) !== undefined) return false;
      const from = view.planPointAt(x, y);
      if (p.readOnly || !p.onDrag || !from) return false;
      const hit = hitAt(view, p.index, x, y);
      if (!p.onDrag("start", from, from, hit)) return false;
      drag = { from, hit, to: from };
      return true;
    },
    move(x, y) {
      const to = view.planPointAt(x, y);
      if (!drag || !to) return;
      drag.to = to;
      props.current.onDrag?.("move", drag.from, to, drag.hit);
    },
    end: (x, y) => finish(x, y),
  };
}

/** Pointer events on the view, as the builder's events in plan points and entity ids. */
export function useStageEvents(
  view: WorldView | undefined,
  props: MutableRefObject<
    StageEvents & { readonly index: BlueprintIndex; readonly readOnly?: boolean }
  >,
): void {
  useEffect(() => {
    if (!view) return;
    const here = (x: number, y: number) => {
      // A person stands in front of what is behind them: a click on them is theirs alone.
      if (view.crew.hit(x, y) !== undefined) return undefined;
      const at = view.planPointAt(x, y);
      return at ? { at, hit: hitAt(view, props.current.index, x, y) } : undefined;
    };
    const offs = [
      view.rig.onClick((x, y, e) => {
        const p = here(x, y);
        if (p) props.current.onClick?.(p.at, p.hit, { shift: e.shiftKey });
      }),
      view.rig.onDoubleClick((x, y) => {
        const p = here(x, y);
        if (p) props.current.onDoubleClick?.(p.at, p.hit);
      }),
      view.rig.onHover((x, y) => {
        const p = here(x, y);
        props.current.onHover?.(p?.at, p?.hit);
      }),
    ];
    view.setDragTool(dragTool(view, props));
    return () => {
      for (const off of offs) off();
      view.setDragTool(undefined);
    };
  }, [view, props]);
}
