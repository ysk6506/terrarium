/**
 * The airflow map as the 3D view holds it (REQ-072, ADR-0074): one layer on the room being looked at,
 * and the plan camera (the same scene seen straight down through an orthographic camera, not a second
 * renderer). The view tells it when the focus or the building changed; the page tells it what to show.
 */
import * as THREE from "three";
import { hallAir, world3d } from "../../logic";
import type { AirConfig, AirHost, AirPort } from "./air-port";
import { type AirflowLayer, type AirMode, buildAirflowLayer } from "./airflow-layer";
import type { Engine } from "./engine";
import type { Rig } from "./rig";
import { calm } from "./view-look";

type Focus = world3d.Focus;

/** Room left around the racks and cooling when the camera goes in on them, metres. */
const WORK_MARGIN_M = 1.6;
/** How high the work stands above the raised floor (a rack and the air over it), metres. */
const WORK_HEIGHT_M = 2.6;

/** Straight down, a hair short of it so the camera has an "up". */
const STRAIGHT_DOWN = Math.PI / 2 - 0.001;

export class AirStage implements AirPort {
  private cfg: AirConfig | undefined;
  private mounted: { readonly roomId: string; readonly layer: AirflowLayer } | undefined;
  private shown: { readonly air: world3d.Airflow; readonly view: world3d.AirView } | undefined;
  private mode: AirMode = calm() ? "still" : "live";
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly engine: Engine,
    private readonly rig: Rig,
    private readonly host: AirHost,
  ) {}

  /** The room being drawn, if the map is on and the camera is in that room. */
  get active(): boolean {
    return this.mounted !== undefined;
  }

  get inset(): number {
    return this.cfg?.inset ?? 0;
  }

  /** Whether this focus is looked at as a plan. */
  flat(focus: Focus): boolean {
    return Boolean(this.cfg?.map) && focus.kind === "room" && focus.id === this.cfg?.roomId;
  }

  set(cfg: AirConfig | undefined): void {
    const before = this.cfg;
    this.cfg = cfg;
    if (cfg) this.setMode(cfg.mode);
    this.sync();
    const same = before && cfg && before.roomId === cfg.roomId;
    const moved =
      Boolean(before?.map) !== Boolean(cfg?.map) || (before?.inset ?? 0) !== (cfg?.inset ?? 0);
    if (!same || moved) this.host.refocus();
  }

  /** The focus or the building changed: build the layer in the room, or let go of it. */
  sync(): void {
    const cfg = this.cfg;
    const focus = this.host.focus();
    const building = this.host.building();
    if (!cfg || !building || focus.kind !== "room" || focus.id !== cfg.roomId) {
      this.release();
      this.plan(false);
      return;
    }
    if (this.mounted?.roomId !== cfg.roomId) {
      this.release();
      const layer = buildAirflowLayer(this.engine, cfg.scene, cfg.air);
      if (!building.mountInRoom(cfg.roomId, layer.group)) {
        layer.dispose();
        return;
      }
      layer.setMode(this.mode);
      this.mounted = { roomId: cfg.roomId, layer };
      this.shown = undefined;
    }
    const { layer } = this.mounted as NonNullable<typeof this.mounted>;
    if (this.shown?.air !== cfg.air || this.shown?.view !== cfg.view) {
      layer.update(cfg.air, cfg.view, hallAir.aisleReach(cfg.scene, cfg.air));
      this.shown = { air: cfg.air, view: cfg.view };
    }
    layer.setTopDown(cfg.map);
    layer.setPicked(cfg.picked);
    this.plan(cfg.map);
  }

  /** Switch the camera between the three-quarter view and the plan. */
  private plan(on: boolean): void {
    if (this.engine.topDown === on) return;
    this.engine.setTopDown(on);
    this.rig.setFlat(on);
    this.host.building()?.showContainment(!on && this.host.focus().kind !== "rack");
  }

  /** A pose that fits the room into the picture beside the card: a plan from straight above, or the usual angle. */
  poseOf(
    box: world3d.Box3,
    focus: Focus,
    lens: world3d.Lens,
    size: { w: number; h: number },
  ): world3d.Pose {
    const inset = Math.min(this.inset, size.w * 0.5);
    const fitted = { fov: lens.fov, aspect: Math.max(0.3, (size.w - inset) / size.h) };
    const base = this.flat(focus)
      ? this.planPose(box, fitted)
      : world3d.poseFor(this.workBox(box, focus), focus.kind, fitted);
    if (inset <= 0) return base;
    // Move the target toward the card's side so the room sits in the free part of the picture.
    const metresPerPixel = (2 * base.distance * Math.tan(fitted.fov / 2)) / size.h;
    const shift = (inset / 2) * metresPerPixel;
    const [x, y, z] = base.target;
    return { ...base, target: [x + Math.cos(base.yaw) * shift, y, z - Math.sin(base.yaw) * shift] };
  }

  /** In the three-quarter view the camera goes in on the racks and the cooling, not on the empty rest of a big room. */
  private workBox(box: world3d.Box3, focus: Focus): world3d.Box3 {
    const cfg = this.cfg;
    if (!cfg || focus.kind !== "room" || focus.id !== cfg.roomId) return box;
    const work = hallAir.workBounds(cfg.scene, cfg.air, WORK_MARGIN_M);
    if (!work) return box;
    return {
      x0: box.x0 + work.x0,
      x1: box.x0 + work.x1,
      z0: box.z0 + work.z0,
      z1: box.z0 + work.z1,
      y0: box.y0,
      y1: box.y0 + world3d.RAISED_FLOOR_M + WORK_HEIGHT_M,
    };
  }

  private planPose(box: world3d.Box3, lens: world3d.Lens): world3d.Pose {
    const floor = box.y0 + world3d.RAISED_FLOOR_M;
    const flat = { ...box, y0: floor, y1: floor };
    const angle = { yaw: 0, pitch: STRAIGHT_DOWN };
    return {
      target: [(box.x0 + box.x1) / 2, floor, (box.z0 + box.z1) / 2],
      distance: world3d.fitDistance(flat, angle, lens) * 1.08,
      ...angle,
    };
  }

  /** Visit every rack of the room with where its top shows on the canvas, in pixels. */
  forEachRack(
    size: { w: number; h: number },
    visit: (id: string, x: number, y: number, visible: boolean) => void,
  ): void {
    const mounted = this.mounted;
    const cfg = this.cfg;
    if (!mounted || !cfg) return;
    const camera = this.engine.view;
    for (const r of cfg.air.racks) {
      mounted.layer.toWorld(r.x, cfg.scene.floorY + r.h, r.z, this.v).project(camera);
      visit(
        r.id,
        ((this.v.x + 1) / 2) * size.w,
        ((1 - this.v.y) / 2) * size.h,
        this.v.z > -1 && this.v.z < 1,
      );
    }
  }

  setMode(mode: AirMode): void {
    this.mode = mode;
    this.mounted?.layer.setMode(mode);
  }

  private release(): void {
    this.mounted?.layer.dispose();
    this.mounted = undefined;
    this.shown = undefined;
  }

  dispose(): void {
    this.release();
    this.plan(false);
    this.cfg = undefined;
  }
}
