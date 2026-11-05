/**
 * The camera rig: orbit, pan and zoom by mouse, touch and wheel, and a smooth fly to a pose (REQ-006).
 * The pose (`world3d.Pose`) is the one source of truth; the camera is set from it. A drag tool (the
 * builder's) can take the left-button drag from the camera.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import type { Engine } from "./engine";

type Pose = world3d.Pose;

export interface Limits {
  readonly minDistance: number;
  readonly maxDistance: number;
}

/** Takes the left-button drag away from the camera: the builder drawing a room, say. */
export interface DragTool {
  /** Once the pointer has moved far enough to be a drag: return true to take it. Position is where the pointer went down, element pixels. */
  start(x: number, y: number, event: PointerEvent): boolean;
  move(x: number, y: number): void;
  /** At pointer up (or when it is cancelled). */
  end(x: number, y: number, cancelled: boolean): void;
}

export interface Rig {
  pose(): Pose;
  /** Move to a pose at once. */
  set(pose: Pose): void;
  /** Glide to a pose; `ms` 0 jumps. */
  flyTo(pose: Pose, ms?: number): void;
  setLimits(limits: Limits): void;
  setDragTool(tool: DragTool | undefined): void;
  /** A click that was not a drag, in element pixels. */
  onClick(listener: (x: number, y: number, event: PointerEvent) => void): () => void;
  /** Two quick clicks, in element pixels. */
  onDoubleClick(listener: (x: number, y: number, event: MouseEvent) => void): () => void;
  /** The pointer moved without dragging (for hover). */
  onHover(listener: (x: number, y: number) => void): () => void;
  /** On a plan the camera only slides and zooms: a drag pans, and turning is left to the buttons. */
  setFlat(flat: boolean): void;
  /** The user moved the camera. */
  onUserMove(listener: () => void): () => void;
  dispose(): void;
}

const PITCH_MIN = (4 * Math.PI) / 180;
const PITCH_MAX = (86 * Math.PI) / 180;
const DRAG_PX = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function turnBetween(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The pose and what can be done to it; every change reaches the camera through `set`. */
class Cam {
  pose: Pose = { target: [0, 0, 0], distance: 100, yaw: -0.66, pitch: 0.52 };
  limits: Limits = { minDistance: 3, maxDistance: 6000 };
  flat = false;

  constructor(
    private readonly engine: Engine,
    private readonly element: HTMLElement,
  ) {
    this.apply();
  }

  private apply(): void {
    const { camera, fill } = this.engine;
    const [px, py, pz] = world3d.positionOf(this.pose);
    camera.position.set(px, py, pz);
    camera.lookAt(...this.pose.target);
    camera.near = clamp(this.pose.distance / 80, 0.1, 15);
    camera.updateProjectionMatrix();
    this.engine.frameOrtho(this.pose.distance);
    fill.position.set(px, py + 2, pz);
    this.engine.invalidate();
  }

  set(p: Pose): void {
    const { minDistance, maxDistance } = this.limits;
    this.pose = { ...p, distance: clamp(p.distance, minDistance, maxDistance) };
    this.apply();
  }

  pan(dx: number, dy: number): void {
    const { pose } = this;
    const scale =
      (2 * pose.distance * Math.tan((this.engine.camera.fov * Math.PI) / 360)) /
      this.element.clientHeight;
    const right = new THREE.Vector3(Math.cos(pose.yaw), 0, -Math.sin(pose.yaw));
    const forward = new THREE.Vector3(-Math.sin(pose.yaw), 0, -Math.cos(pose.yaw));
    const [x, y, z] = pose.target;
    const move = right.multiplyScalar(-dx * scale).addScaledVector(forward, dy * scale);
    this.set({ ...pose, target: [x + move.x, y, z + move.z] });
  }

  orbit(dx: number, dy: number): void {
    const { pose } = this;
    this.set({
      ...pose,
      yaw: pose.yaw - dx * 0.006,
      pitch: clamp(pose.pitch + dy * 0.005, PITCH_MIN, PITCH_MAX),
    });
  }

  zoom(factor: number): void {
    this.set({ ...this.pose, distance: this.pose.distance * factor });
  }
}

interface Hooks {
  user(): void;
  hover(x: number, y: number): void;
  double(x: number, y: number, event: MouseEvent): void;
  click(x: number, y: number, event: PointerEvent): void;
  tool(): DragTool | undefined;
}

type Xy = { x: number; y: number };

/** Where the pointers are and what they are doing: pressed, dragging the camera, or dragging a tool. */
class Pointers {
  private readonly down = new Map<number, Xy>();
  private travelled = 0;
  private pinch = 0;
  private taken: DragTool | undefined;
  private candidate: DragTool | undefined;
  private downAt: Xy = { x: 0, y: 0 };

  constructor(
    private readonly element: HTMLElement,
    private readonly cam: Cam,
    private readonly hooks: Hooks,
  ) {}

  local(e: { clientX: number; clientY: number }): Xy {
    const rect = this.element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  press(e: PointerEvent): void {
    this.element.setPointerCapture(e.pointerId);
    this.down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.travelled = 0;
    this.pinch = 0;
    this.downAt = this.local(e);
    this.taken = undefined;
    this.candidate = e.button === 0 && this.down.size === 1 ? this.hooks.tool() : undefined;
  }

  private gesture(e: PointerEvent, dx: number, dy: number): void {
    if (this.down.size >= 2) {
      const [a, b] = [...this.down.values()] as [Xy, Xy];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0) this.cam.zoom(this.pinch / spread);
      this.pinch = spread;
      this.cam.pan(dx / 2, dy / 2);
    } else if (e.buttons & 2 || e.buttons & 4 || e.shiftKey || this.cam.flat) this.cam.pan(dx, dy);
    else this.cam.orbit(dx, dy);
  }

  move(e: PointerEvent): void {
    const last = this.down.get(e.pointerId);
    const at = this.local(e);
    if (!last) {
      this.hooks.hover(at.x, at.y);
      return;
    }
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    this.travelled += Math.abs(dx) + Math.abs(dy);
    this.down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.candidate && this.travelled >= DRAG_PX) {
      this.taken = this.candidate.start(this.downAt.x, this.downAt.y, e)
        ? this.candidate
        : undefined;
      this.candidate = undefined;
    }
    if (this.taken) this.taken.move(at.x, at.y);
    else if (this.travelled >= DRAG_PX) {
      this.hooks.user();
      this.gesture(e, dx, dy);
    }
  }

  release(e: PointerEvent): void {
    const wasDrag = this.travelled >= DRAG_PX;
    const at = this.local(e);
    this.down.delete(e.pointerId);
    this.pinch = 0;
    this.candidate = undefined;
    if (this.taken) {
      const tool = this.taken;
      this.taken = undefined;
      tool.end(at.x, at.y, e.type === "pointercancel");
    } else if (!wasDrag && e.button === 0) this.hooks.click(at.x, at.y, e);
  }
}

/** Mouse, touch and wheel on the element; returns how to let go of it. */
function bindInput(element: HTMLElement, cam: Cam, hooks: Hooks): () => void {
  const pointers = new Pointers(element, cam, hooks);
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    hooks.user();
    cam.zoom(Math.exp(clamp(e.deltaY, -240, 240) * 0.0014));
  };
  const menu = (e: Event) => e.preventDefault();
  const double = (e: MouseEvent) => {
    const at = pointers.local(e);
    hooks.double(at.x, at.y, e);
  };
  const down = (e: PointerEvent) => pointers.press(e);
  const move = (e: PointerEvent) => pointers.move(e);
  const up = (e: PointerEvent) => pointers.release(e);
  const events: [string, EventListener, AddEventListenerOptions?][] = [
    ["pointerdown", down as EventListener],
    ["dblclick", double as EventListener],
    ["pointermove", move as EventListener],
    ["pointerup", up as EventListener],
    ["pointercancel", up as EventListener],
    ["wheel", wheel as EventListener, { passive: false }],
    ["contextmenu", menu],
  ];
  for (const [name, fn, opts] of events) element.addEventListener(name, fn, opts);
  return () => {
    for (const [name, fn] of events) element.removeEventListener(name, fn);
  };
}

/** Glide the camera to a pose; returns how to stop. */
function glide(engine: Engine, cam: Cam, to: Pose, ms: number, done: () => void): () => void {
  const from = cam.pose;
  const turn = turnBetween(from.yaw, to.yaw);
  const end = engine.animate();
  let t = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    off();
    end();
    done();
  };
  const off = engine.onFrame((dt) => {
    t = Math.min(1, t + (dt * 1000) / ms);
    const k = ease(t);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    cam.set({
      target: [
        lerp(from.target[0], to.target[0]),
        lerp(from.target[1], to.target[1]),
        lerp(from.target[2], to.target[2]),
      ],
      distance: from.distance * (to.distance / from.distance) ** k,
      yaw: from.yaw + turn * k,
      pitch: lerp(from.pitch, to.pitch),
    });
    if (t >= 1) stop();
  });
  return stop;
}

const subscribe = <T>(set: Set<T>, listener: T) => {
  set.add(listener);
  return () => set.delete(listener);
};

export function createRig(engine: Engine, element: HTMLElement): Rig {
  const cam = new Cam(engine, element);
  const clicks = new Set<(x: number, y: number, e: PointerEvent) => void>();
  const hovers = new Set<(x: number, y: number) => void>();
  const doubles = new Set<(x: number, y: number, e: MouseEvent) => void>();
  const moves = new Set<() => void>();
  let flight: (() => void) | undefined;
  let tool: DragTool | undefined;

  const stopFlight = () => flight?.();
  const unbind = bindInput(element, cam, {
    user: () => {
      stopFlight();
      for (const l of moves) l();
    },
    hover: (x, y) => {
      for (const h of hovers) h(x, y);
    },
    click: (x, y, e) => {
      for (const c of clicks) c(x, y, e);
    },
    double: (x, y, e) => {
      for (const d of doubles) d(x, y, e);
    },
    tool: () => tool,
  });

  const flyTo = (to: Pose, ms = 900) => {
    stopFlight();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (ms <= 0 || reduced) return cam.set(to);
    const stop = glide(engine, cam, to, ms, () => {
      if (flight === stop) flight = undefined;
    });
    flight = stop;
  };

  return {
    pose: () => cam.pose,
    set: (p) => cam.set(p),
    flyTo,
    setLimits: (l) => {
      cam.limits = l;
      cam.set(cam.pose);
    },
    setFlat: (flat) => {
      cam.flat = flat;
    },
    setDragTool: (t) => {
      tool = t;
    },
    onClick: (l) => subscribe(clicks, l),
    onDoubleClick: (l) => subscribe(doubles, l),
    onHover: (l) => subscribe(hovers, l),
    onUserMove: (l) => subscribe(moves, l),
    dispose: () => {
      stopFlight();
      unbind();
    },
  };
}
