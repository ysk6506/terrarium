/**
 * What the 3D view needs from the airflow map (REQ-072): a port with nothing behind it until the map is opened.
 * The map's drawing code (`AirStage` and the layers under it) is a bundle of its own that the map downloads
 * when the first person opens it, so the first screen carries only this.
 */
import type { world3d } from "../../logic";
import type { AirMode } from "./airflow-layer";
import type { BuildingLayer } from "./building-layer";
import type { Engine } from "./engine";
import type { Rig } from "./rig";

type Focus = world3d.Focus;

export interface AirConfig {
  readonly roomId: string;
  readonly scene: world3d.RoomScene;
  readonly air: world3d.Airflow;
  readonly view: world3d.AirView;
  /** The plan seen from above (an orthographic camera) instead of the three-quarter view. */
  readonly map: boolean;
  readonly picked?: string;
  /** Pixels on the right of the picture that a card covers: the room is fitted into the rest. */
  readonly inset?: number;
  /** How the air moves: live, only arrows standing still, or no air. */
  readonly mode: AirMode;
}

/** What the air stage needs from the view that owns it. */
export interface AirHost {
  building(): BuildingLayer | undefined;
  focus(): Focus;
  /** Fly again to the current focus (the way it is looked at changed). */
  refocus(): void;
}

/** The airflow map as the view uses it. */
export interface AirPort {
  set(cfg: AirConfig | undefined): void;
  /** The focus or the building changed. */
  sync(): void;
  /** A pose that fits the room into the picture beside the card. */
  poseOf(
    box: world3d.Box3,
    focus: Focus,
    lens: world3d.Lens,
    size: { w: number; h: number },
  ): world3d.Pose;
  forEachRack(
    size: { w: number; h: number },
    visit: (id: string, x: number, y: number, visible: boolean) => void,
  ): void;
  dispose(): void;
}

/** Makes the real stage; the map's bundle supplies it. */
export type AirMaker = (engine: Engine, rig: Rig, host: AirHost) => AirPort;

/** No map yet: nothing to show, and the camera takes the usual pose. */
export function idleAir(poseFor: typeof world3d.poseFor): AirPort {
  return {
    set: () => undefined,
    sync: () => undefined,
    poseOf: (box, focus, lens, size) =>
      poseFor(box, focus.kind, { fov: lens.fov, aspect: Math.max(0.3, size.w / size.h) }),
    forEachRack: () => undefined,
    dispose: () => undefined,
  };
}
