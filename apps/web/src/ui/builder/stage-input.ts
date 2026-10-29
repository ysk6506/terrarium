/**
 * Pointer and keyboard on the stage: hover, click, double-click, dragging (a tool's or the view's),
 * wheel zoom, and Q/E/+/- for the camera. Reports plan positions; knows nothing about the builder.
 */
import type { PlanPoint, StageEvents } from "./Stage";
import { pointerOn, type World3D } from "./stage-draw";

interface Drag {
  x: number;
  y: number;
  from?: PlanPoint;
  hit?: string;
  mode: "pending" | "tool" | "pan";
  button: number;
}

export interface InputTarget {
  world(): World3D | undefined;
  events(): StageEvents & { readonly readOnly?: boolean };
  redraw(): void;
}

/** Pan the view by a pointer movement; vertical distances are foreshortened on an isometric ground. */
function pan(w: World3D, canvas: HTMLCanvasElement, dxPx: number, dyPx: number): void {
  const rect = canvas.getBoundingClientRect();
  const scale = (w.view.span * w.view.zoom) / rect.height;
  const dx = dxPx * scale;
  const dy = dyPx * scale * 1.732;
  const a = (w.view.azimuth * Math.PI) / 180;
  w.view.cx -= dx * Math.cos(a) + dy * Math.sin(a);
  w.view.cz -= -dx * Math.sin(a) + dy * Math.cos(a);
}

const CAMERA_KEYS: Readonly<Record<string, (v: World3D["view"]) => void>> = {
  q: (v) => {
    v.azimuth = (v.azimuth + 90) % 360;
  },
  e: (v) => {
    v.azimuth = (v.azimuth + 270) % 360;
  },
  "+": (v) => {
    v.zoom = Math.max(0.08, v.zoom / 1.2);
  },
  "=": (v) => {
    v.zoom = Math.max(0.08, v.zoom / 1.2);
  },
  "-": (v) => {
    v.zoom = Math.min(4, v.zoom * 1.2);
  },
};

/** Pointer handlers: hover, click, double-click, and drags that either a tool takes or pan the view. */
function pointerHandlers(canvas: HTMLCanvasElement, target: InputTarget) {
  let drag: Drag | undefined;
  const at = (e: { clientX: number; clientY: number }) => {
    const w = target.world();
    return w ? pointerOn(w, canvas, e) : { point: undefined, hit: undefined };
  };
  const startDrag = (d: Drag, to: PlanPoint | undefined) => {
    const ev = target.events();
    const take =
      d.button === 0 && !ev.readOnly && d.from && to
        ? ev.onDrag?.("start", d.from, to, d.hit)
        : false;
    d.mode = take ? "tool" : "pan";
  };
  const panBy = (d: Drag, e: PointerEvent) => {
    const w = target.world();
    if (!w) return;
    pan(w, canvas, e.clientX - d.x, e.clientY - d.y);
    d.x = e.clientX;
    d.y = e.clientY;
    target.redraw();
  };
  return {
    pointerdown(e: PointerEvent) {
      const p = at(e);
      drag = {
        x: e.clientX,
        y: e.clientY,
        mode: "pending",
        button: e.button,
        ...(p.point ? { from: p.point } : {}),
        ...(p.hit ? { hit: p.hit } : {}),
      };
      canvas.setPointerCapture(e.pointerId);
    },
    pointermove(e: PointerEvent) {
      const p = at(e);
      if (!drag) return target.events().onHover?.(p.point, p.hit);
      if (drag.mode === "pending" && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4)
        startDrag(drag, p.point);
      if (drag.mode === "tool" && drag.from && p.point)
        target.events().onDrag?.("move", drag.from, p.point, drag.hit);
      if (drag.mode === "pan") panBy(drag, e);
    },
    pointerup(e: PointerEvent) {
      const d = drag;
      drag = undefined;
      if (!d) return;
      const p = at(e);
      if (d.mode === "tool" && d.from && p.point)
        target.events().onDrag?.("end", d.from, p.point, d.hit);
      if (d.mode === "pending" && d.button === 0 && p.point)
        target.events().onClick?.(p.point, p.hit, { shift: e.shiftKey });
    },
    pointerleave() {
      target.events().onHover?.(undefined, undefined);
    },
    dblclick(e: MouseEvent) {
      const p = at(e);
      if (p.point) target.events().onDoubleClick?.(p.point, p.hit);
    },
  };
}

/** Camera handlers: wheel zoom and the Q/E/+/- keys. */
function viewHandlers(target: InputTarget) {
  return {
    wheel(e: WheelEvent) {
      const w = target.world();
      if (!w) return;
      e.preventDefault();
      w.view.zoom = Math.min(4, Math.max(0.08, w.view.zoom * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
      target.redraw();
    },
    keydown(e: KeyboardEvent) {
      const w = target.world();
      const action = CAMERA_KEYS[e.key.toLowerCase()];
      if (!w || !action) return;
      action(w.view);
      target.redraw();
    },
    contextmenu(e: MouseEvent) {
      e.preventDefault();
    },
  };
}

/** Listen on the canvas; returns the function that stops listening. */
export function attachInput(canvas: HTMLCanvasElement, target: InputTarget): () => void {
  const handlers: Record<string, (e: never) => void> = {
    ...pointerHandlers(canvas, target),
    ...viewHandlers(target),
  };
  const options = (name: string) => (name === "wheel" ? { passive: false } : undefined);
  for (const [name, fn] of Object.entries(handlers))
    canvas.addEventListener(name, fn as EventListener, options(name));
  return () => {
    for (const [name, fn] of Object.entries(handlers))
      canvas.removeEventListener(name, fn as EventListener);
  };
}
