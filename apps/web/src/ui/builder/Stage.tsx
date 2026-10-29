/**
 * The 3D view of one level (REQ-006, REQ-036): an isometric glass case with the floor tiles inside,
 * one instanced mesh per look (so draw calls do not grow with the world), drawn only when something
 * changes. It knows nothing about blueprints — it draws a Scene and reports where people point.
 */
import {
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import type { builder } from "../../logic";
import {
  buildFloor,
  buildGroups,
  buildOverlay,
  create,
  disposeChildren,
  placeCamera,
  type World3D,
} from "./stage-draw";
import { attachInput } from "./stage-input";

export interface PlanPoint {
  readonly x: number;
  readonly y: number;
}

export interface Ghost {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly ok: boolean;
}

export interface StageEvents {
  onHover?(point: PlanPoint | undefined, hit: string | undefined): void;
  onClick?(point: PlanPoint, hit: string | undefined, mods: { readonly shift: boolean }): void;
  onDoubleClick?(point: PlanPoint, hit: string | undefined): void;
  /** Return true at "start" to take the drag (tool or move); otherwise the drag pans the view. */
  onDrag?(
    phase: "start" | "move" | "end",
    from: PlanPoint,
    to: PlanPoint,
    hit: string | undefined,
  ): boolean | undefined;
}

interface StageProps extends StageEvents {
  readonly scene: builder.Scene;
  /** Grid step of the floor (m): tiles in rooms, larger in plans. */
  readonly grid: number;
  readonly selected?: readonly string[];
  readonly ghost?: Ghost;
  /** The camera refits when this changes (a new level). */
  readonly fitKey: string;
  readonly readOnly?: boolean;
  readonly label?: string;
  readonly children?: ReactNode;
}

interface Label {
  readonly id: string;
  readonly text: string;
  readonly left: number;
  readonly top: number;
}

/** The three.js world behind the canvas: made once, resized with its box, disposed on leaving. */
function useWorld3D(
  world: MutableRefObject<World3D | undefined>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  wrapRef: RefObject<HTMLDivElement | null>,
  onResize: () => void,
) {
  const [failed, setFailed] = useState(false);
  const resized = useRef(onResize);
  resized.current = onResize;
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let w: World3D;
    try {
      w = create(canvas);
    } catch {
      setFailed(true);
      return;
    }
    world.current = w;
    const observer = new ResizeObserver(() => {
      const { width, height } = wrap.getBoundingClientRect();
      w.renderer.setSize(width, height, false);
      resized.current();
    });
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      disposeChildren(w.content);
      disposeChildren(w.overlay);
      w.renderer.dispose();
      world.current = undefined;
    };
  }, [world, canvasRef, wrapRef]);
  return failed;
}

function Labels({ labels }: { readonly labels: readonly Label[] }) {
  return (
    <>
      {labels.map((l) => (
        <span key={l.id} className="stage-label" style={{ left: l.left, top: l.top }}>
          {l.text}
        </span>
      ))}
    </>
  );
}

/** Keep the three.js world in step: refit per level, rebuild per scene, outline per selection. */
function useSceneDraw(
  world: RefObject<World3D | undefined>,
  props: StageProps,
  redraw: () => void,
) {
  // Fit the camera to a new level.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit only when the level changes
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    const { area } = props.scene;
    w.view = {
      ...w.view,
      cx: area.w / 2,
      cz: area.d / 2,
      zoom: 1,
      span: Math.max(area.w, area.d) * 1.15 + 2,
    };
    redraw();
  }, [props.fitKey]);

  // Redraw the contents when the scene changes, the outlines when the selection or ghost does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scene and grid drive it
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    disposeChildren(w.content);
    buildFloor(w, props.scene.area, props.grid);
    buildGroups(w, props.scene);
    buildOverlay(w, props.scene, props.selected ?? [], props.ghost);
    redraw();
  }, [props.scene, props.grid]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: overlay inputs drive it
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    buildOverlay(w, props.scene, props.selected ?? [], props.ghost);
    w.render();
  }, [props.selected, props.ghost]);
}

export function Stage(props: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const latest = useRef<StageProps>(props);
  latest.current = props;
  const world = useRef<World3D | undefined>(undefined);
  const [labels, setLabels] = useState<Label[]>([]);

  const redraw = useCallback(() => {
    const w = world.current;
    const wrap = wrapRef.current;
    if (!w || !wrap) return;
    const { width, height } = wrap.getBoundingClientRect();
    placeCamera(w, width, height);
    w.render();
    setLabels(
      latest.current.scene.labels.map((l) => {
        const v = new THREE.Vector3(l.x, l.y, l.z).project(w.camera);
        return {
          id: l.id,
          text: l.text,
          left: ((v.x + 1) / 2) * width,
          top: ((1 - v.y) / 2) * height,
        };
      }),
    );
  }, []);
  const failed = useWorld3D(world, canvasRef, wrapRef, redraw);

  useSceneDraw(world, props, redraw);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachInput(canvas, {
      world: () => world.current,
      events: () => latest.current,
      redraw,
    });
  }, [redraw]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      {failed ? (
        <div className="note note-warn" style={{ margin: 20 }}>
          이 브라우저에서는 3D를 그릴 수 없다(WebGL이 꺼져 있다). 목록과 패널로는 계속 편집할 수
          있다.
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={props.label ?? "세계의 3D 보기. 끌어서 이동, 휠로 확대, Q와 E로 돌린다."}
          style={{ touchAction: "none" }}
        />
      )}
      <Labels labels={labels} />
      {props.children}
    </div>
  );
}
