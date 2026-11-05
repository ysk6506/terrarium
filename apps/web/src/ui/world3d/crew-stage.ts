/**
 * The people of the room being looked at, as the 3D view holds them (REQ-074, ADR-0078): one layer
 * mounted in the room when the camera is in it, and nowhere else. The page says which room, who is
 * there (`world3d.Crew`) and what is the matter; a click on a person says a line and the page shows it
 * as a speech bubble for a few seconds. Clicking a person never reaches the machine behind them.
 */
import * as THREE from "three";
import type { world3d } from "../../logic";
import type { BuildingLayer } from "./building-layer";
import type { CrewLayer } from "./crew-layer";
import type { Engine } from "./engine";

type Focus = world3d.Focus;
type Trouble = Pick<world3d.CrewWorld, "alarms" | "activity">;

/** What the crew module brings (it is loaded when the camera first goes into a room, so the first screen does not carry it). */
export interface CrewKit {
  build(engine: Engine, crew: world3d.Crew, still: boolean): CrewLayer;
  lineFor: typeof world3d.lineFor;
}

export interface CrewConfig {
  readonly kit: CrewKit;
  readonly roomId: string;
  readonly crew: world3d.Crew;
  readonly trouble: Trouble;
  /** The name of a rack or machine, for the lines that name it. */
  readonly nameOf: (id: string) => string;
}

/** A line being said: what, and where the head of the speaker is on the canvas now. */
export interface Say {
  readonly text: string;
  readonly person: number;
  readonly at: () => { readonly x: number; readonly y: number; readonly visible: boolean };
}

export interface CrewHost {
  building(): BuildingLayer | undefined;
  focus(): Focus;
  /** The ray through a pixel of the canvas. */
  ray(x: number, y: number): THREE.Raycaster;
  size(): { readonly w: number; readonly h: number };
  camera(): THREE.Camera;
}

const NONE: Trouble = { alarms: [], activity: [] };

/** How long a line stays on screen, ms. */
export const SAY_MS = 4000;

export class CrewStage {
  private cfg: CrewConfig | undefined;
  private mounted:
    | { readonly roomId: string; readonly layer: CrewLayer; readonly crew: world3d.Crew }
    | undefined;
  private still = false;
  private readonly counts = new Map<number, number>();
  private readonly listeners = new Set<(say: Say | undefined) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly engine: Engine,
    private readonly host: CrewHost,
  ) {}

  /** The room and what is the matter in it; none takes the people away. */
  set(cfg: CrewConfig | undefined): void {
    const before = this.cfg;
    this.cfg = cfg;
    if (before?.crew !== cfg?.crew) this.counts.clear();
    this.sync();
    this.mounted?.layer.setTrouble(cfg?.trouble ?? NONE);
  }

  /** The focus or the building changed: put the people in the room, or take them away. */
  sync(): void {
    const cfg = this.cfg;
    const focus = this.host.focus();
    const building = this.host.building();
    const wanted = cfg && building && focus.kind === "room" && focus.id === cfg.roomId;
    if (!wanted) {
      this.release();
      return;
    }
    if (this.mounted?.crew === cfg.crew && this.mounted.roomId === cfg.roomId) return;
    this.release();
    const layer = cfg.kit.build(this.engine, cfg.crew, this.still);
    if (!building.mountInRoom(cfg.roomId, layer.group)) {
      layer.dispose();
      return;
    }
    layer.setTrouble(cfg.trouble);
    this.mounted = { roomId: cfg.roomId, layer, crew: cfg.crew };
  }

  setStill(on: boolean): void {
    this.still = on;
    this.mounted?.layer.setStill(on);
  }

  /** Whether a pixel of the canvas is over a person (and which); they stand in front of what is behind them. */
  hit(x: number, y: number): number | undefined {
    const layer = this.mounted?.layer;
    if (!layer) return undefined;
    const here = layer.pickables.filter((o) => o.userData.present);
    layer.group.updateWorldMatrix(true, true);
    const found = this.host.ray(x, y).intersectObjects(here, false)[0];
    return found ? (found.object.userData.crew as number) : undefined;
  }

  /** A click: a person says a line. Returns whether one was hit. */
  click(x: number, y: number): boolean {
    const i = this.hit(x, y);
    if (i === undefined) return false;
    this.say(i);
    return true;
  }

  private say(i: number): void {
    const mounted = this.mounted;
    const cfg = this.cfg;
    const st = mounted?.layer.stateOf(i);
    if (!mounted || !cfg || !st) return;
    const n = this.counts.get(i) ?? 0;
    this.counts.set(i, n + 1);
    const device = st.device ? cfg.nameOf(st.device) : undefined;
    const text = cfg.kit.lineFor({ id: i }, st.situation, n, device);
    const at = () => {
      const p = mounted.layer.head(i, this.v).project(this.host.camera());
      const { w, h } = this.host.size();
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, visible: p.z > -1 && p.z < 1 };
    };
    this.emit({ text, person: i, at });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emit(undefined), SAY_MS);
  }

  /** Be told when a line is said and when it ends. */
  onSay(listener: (say: Say | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(say: Say | undefined): void {
    for (const l of this.listeners) l(say);
  }

  /** Take the people away (the building they stand in is going). */
  release(): void {
    if (!this.mounted) return;
    this.mounted.layer.dispose();
    this.mounted = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.emit(undefined);
    this.engine.invalidate();
  }

  dispose(): void {
    this.release();
    this.cfg = undefined;
    this.listeners.clear();
  }
}
