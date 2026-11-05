/**
 * The 3D view as one object (REQ-006): it owns the renderer and camera, builds a layer for each level
 * the viewer opens (site, building, room, rack), flies the camera between them, and tells the page what
 * was clicked. The React component is a thin shell around this class.
 */

import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex } from "@terrarium/core/world";
import * as THREE from "three";
import { builder, world3d } from "../../logic";
import { ActivityLayer } from "./activity-layer";
import { type AirConfig, type AirMaker, type AirPort, idleAir } from "./air-port";
import { type Aisle, AisleStage } from "./aisle-stage";
import { type BuildingLayer, buildBuildingLayer } from "./building-layer";
import { CrewStage } from "./crew-stage";
import { createEngine, type Engine } from "./engine";
import { type PickTag, pickOf } from "./layer";
import { buildLifeLayer, type LifeLayer, type LifeMode } from "./life-layer";
import { PlanOverlay } from "./plan-overlay";
import type { RackState } from "./rack-layer";
import { RackStage } from "./rack-stage";
import { createRig, type DragTool, type Rig } from "./rig";
import { buildSiteLayer, type SiteLayer } from "./site-layer";
import { calm, FILL, ROOM_WALL, TILT } from "./view-look";
import { startSpin } from "./view-spin";

type Focus = world3d.Focus;

export type { Aisle };

export interface ViewEvents {
  /** The viewer clicked something that has a level of its own. */
  readonly onPick?: (tag: PickTag) => void;
  /** The viewer is over something that can be clicked, or off it. */
  readonly onHover?: (tag: PickTag | undefined, x: number, y: number) => void;
  /** The camera moved to a new focus on its own (a click or a jump). */
  readonly onFocus?: (focus: Focus) => void;
  /** A device of the rack in view was pulled out or put back, or the rack turned about. */
  readonly onRack?: (state: RackState) => void;
  /** The camera walked into a containment (its id and name), or out of it (none). */
  readonly onAisle?: (aisle: Aisle | undefined) => void;
}

export class WorldView {
  readonly engine: Engine;
  readonly rig: Rig;
  /** Whether a click on a building, a room or a rack takes the camera there. The builder turns it off, since a click selects. */
  navigate = true;
  /** What the builder draws over the plan: outlines, handles, the ghost. */
  readonly overlay: PlanOverlay;
  private readonly activity: ActivityLayer;
  private air: AirPort = idleAir(world3d.poseFor);
  private airLoaded = false;
  /** The people of the room in view (REQ-074). */
  readonly crew: CrewStage;
  private stopSpin?: () => void;
  private level?: builder.Level;
  private plan?: world3d.PlanFrame;
  private index?: BlueprintIndex;
  private catalog?: Catalog;
  private site?: world3d.SiteScene;
  private siteLayer?: SiteLayer;
  private life?: LifeLayer;
  private lifeMode: LifeMode = calm() ? "still" : "auto";
  /** The rack in view, and the containment looked into (REQ-006, ADR-0101). */
  readonly rack: RackStage;
  private building?: { readonly id: string; readonly layer: BuildingLayer };
  readonly aisle: AisleStage;
  private shown: { layer: world3d.Layer; overlay: world3d.Overlay } = {
    layer: "plain",
    overlay: {},
  };
  private current: Focus = { kind: "site" };
  private readonly ray = new THREE.Raycaster();
  private readonly offs: Array<() => void> = [];
  private size = { w: 1, h: 1 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private events: ViewEvents = {},
  ) {
    this.engine = createEngine(canvas);
    this.rig = createRig(this.engine, canvas);
    this.overlay = new PlanOverlay(() => this.engine.invalidate());
    this.engine.overlay.add(this.overlay.group);
    this.activity = new ActivityLayer(
      this.engine,
      (spot) => this.liftOf(spot),
      () => performance.now(),
    );
    this.engine.overlay.add(this.activity.group);
    this.rack = new RackStage({
      engine: this.engine,
      world: () =>
        this.index && this.catalog ? { index: this.index, catalog: this.catalog } : undefined,
      building: () => this.building?.layer,
      condition: () => this.shown.overlay,
      changed: (s) => this.events.onRack?.(s),
    });
    this.aisle = new AisleStage({
      engine: this.engine,
      rig: this.rig,
      world: () =>
        this.index && this.catalog ? { index: this.index, catalog: this.catalog } : undefined,
      building: () => this.building?.layer,
      focus: () => this.current,
      changed: (a) => this.events.onAisle?.(a),
    });
    this.crew = new CrewStage(this.engine, {
      building: () => this.building?.layer,
      focus: () => this.current,
      ray: (x, y) => {
        this.aim(x, y);
        return this.ray;
      },
      size: () => this.size,
      camera: () => this.engine.view,
    });
    this.crew.setStill(calm());
    this.offs.push(
      this.rig.onClick((x, y) => this.click(x, y)),
      this.rig.onHover((x, y) => {
        if (this.events.onHover) this.events.onHover(this.pickAt(x, y), x, y);
      }),
    );
    this.resize();
  }

  get focus(): Focus {
    return this.current;
  }

  setEvents(events: ViewEvents): void {
    this.events = events;
  }

  /** Show a world. With `keepCamera` the camera stays where it is unless the focus no longer exists. */
  load(index: BlueprintIndex, catalog: Catalog, keepCamera = false): void {
    this.index = index;
    this.catalog = catalog;
    this.leaveBuilding();
    this.siteLayer?.dispose();
    this.life?.dispose();
    this.site = world3d.siteScene(index, catalog);
    this.siteLayer = this.site ? buildSiteLayer(this.engine, this.site) : undefined;
    if (this.siteLayer) this.engine.content.add(this.siteLayer.group);
    this.life = this.site ? buildLifeLayer(this.engine, this.site) : undefined;
    if (this.life) {
      this.engine.content.add(this.life.group);
      this.life.setMode(this.lifeMode);
    }
    if (keepCamera && this.boxOf(this.current)) this.open(this.current, false);
    else this.focusOn(this.current, false);
    this.applyLevel();
  }

  /** Look at what the builder is editing: the camera goes to its level and the plan lines up with it. */
  setLevel(level: builder.Level | undefined, animate = true, wide = false): void {
    this.level = level;
    if (level) this.focusOn(world3d.focusOfLevel(level, wide), animate);
    this.applyLevel();
  }

  private applyLevel(): void {
    const { index, catalog, site } = this;
    const level = this.level;
    this.plan =
      index && catalog && site && level
        ? world3d.planFrame(index, catalog, site, level)
        : undefined;
    this.overlay.setFrame(this.plan);
  }

  private boxOf(focus: Focus): world3d.Box3 | undefined {
    if (!this.index || !this.catalog || !this.site) return undefined;
    return world3d.focusBox(this.index, this.catalog, this.site, focus);
  }

  /** Put the layers of a focus in place: the building opened, the rack drawn, the visitors shown. */
  private open(focus: Focus, animate: boolean): void {
    this.current = focus;
    this.life?.setShown(focus.kind === "site" || focus.kind === "building");
    this.inRoomOnly(focus.kind === "rack");
    this.openBuildingFor(focus, animate);
    this.rack.sync(focus);
    this.air.sync();
    this.crew.sync();
  }

  /** At a rack only the server room is drawn: no yard, no outer wall, a flat wall colour behind and a vignette (feedback 6). */
  private inRoomOnly(on: boolean): void {
    if (this.siteLayer) this.siteLayer.group.visible = !on;
    this.engine.setBackdrop(on ? ROOM_WALL : undefined);
  }

  /** Look at a level, gliding there unless told otherwise. */
  focusOn(focus: Focus, animate = true): void {
    this.aisle.drop();
    const box = this.boxOf(focus);
    if (!box) {
      if (focus.kind !== "site" && this.site) this.focusOn({ kind: "site" }, animate);
      return;
    }
    this.open(focus, animate);
    const lens = {
      fov: (this.engine.camera.fov * Math.PI) / 180,
      aspect: this.engine.camera.aspect,
    };
    const base = this.air.poseOf(box, focus, lens, this.size);
    const pose = this.rack.facing === 0 ? base : { ...base, yaw: base.yaw + this.rack.facing };
    const size = Math.max(box.x1 - box.x0, box.z1 - box.z0);
    this.rig.setLimits({
      minDistance: Math.max(1.5, size * 0.04),
      maxDistance: Math.max(400, size * 6),
    });
    this.rig.flyTo(pose, animate ? 900 : 0);
    const centre = new THREE.Vector3(...pose.target);
    this.engine.fitShadow(
      centre,
      Math.max(40, Math.hypot(box.x1 - box.x0, box.z1 - box.z0) * 0.62),
    );
    this.engine.setTilt(TILT[focus.kind]);
    this.engine.fill.intensity = FILL[focus.kind];
    this.setHaze(focus.kind, pose.distance);
    this.events.onFocus?.(focus);
  }

  /** The map was opened: take the drawing code its bundle brought (once), and show it in the room if the camera is there. */
  loadAir(make: AirMaker): void {
    if (this.airLoaded) return;
    this.airLoaded = true;
    this.air = make(this.engine, this.rig, {
      building: () => this.building?.layer,
      focus: () => this.current,
      refocus: () => this.focusOn(this.current),
    });
    this.air.sync();
  }

  /** Show the airflow map on the room being looked at (REQ-072); none takes it away. */
  setAirflow(config: AirConfig | undefined): void {
    this.air.set(config);
  }

  /** The canvas size, pixels. */
  get canvasSize(): { readonly w: number; readonly h: number } {
    return this.size;
  }

  /** Visit each rack of the airflow map with where it shows on the canvas; follow it with `onRender`. */
  forEachAirRack(visit: (id: string, x: number, y: number, visible: boolean) => void): void {
    this.air.forEachRack(this.size, visit);
  }

  /** Let the little visitors move, stand still, or stay away. */
  setLife(mode: LifeMode): void {
    this.lifeMode = mode;
    this.life?.setMode(mode);
  }

  /** How many visitors walk, drive or roam the site. */
  get visitors(): number {
    return this.life?.count ?? 0;
  }

  /** Outdoors the far land fades into the sky; indoors there is hardly any haze. */
  private setHaze(kind: Focus["kind"], distance: number): void {
    if (kind === "site" || kind === "building") this.engine.setFog(distance * 0.8, distance * 1.9);
    else if (kind === "room") this.engine.setFog(distance * 3 + 30, distance * 9 + 200);
    else if (kind === "rack") this.engine.setFog(distance * 1.0, distance * 2.4);
    else this.engine.setFog(120, 600);
  }

  /** Colour the racks for a layer (power, cooling, heat, …) with what is known about the world. */
  showLayer(layer: world3d.Layer, overlay: world3d.Overlay = {}): void {
    this.shown = { layer, overlay };
    this.building?.layer.recolor(layer, overlay);
    this.rack.setCondition(overlay);
  }

  /** The building a focus is inside, if it is inside one. */
  private buildingOf(focus: Focus): string | undefined {
    if (focus.kind === "site" || !this.index) return undefined;
    if (focus.kind === "building") return focus.id;
    return this.index.enclosing(focus.id, "building")?.id;
  }

  /** The floor a focus is on, if it is on one: a floor itself, or the floor of a room or rack. */
  private floorOf(focus: Focus): string | undefined {
    if (focus.kind === "floor") return focus.id;
    const room = this.roomOf(focus);
    return room ? this.index?.enclosing(room, "floor")?.id : undefined;
  }

  private leaveBuilding(): void {
    this.aisle.drop();
    this.air.dispose();
    this.crew.release();
    this.rack.close();
    if (!this.building) return;
    this.siteLayer?.setBuildingHidden(this.building.id, false);
    this.building.layer.dispose();
    this.building = undefined;
  }

  /** Close the building that was open and open this one (its roof comes off and its floors part). */
  private swapBuilding(id: string | undefined): void {
    this.leaveBuilding();
    const info = this.site?.buildings.find((b) => b.id === id);
    const scene =
      id && this.index && this.catalog
        ? world3d.buildingScene(this.index, this.catalog, id)
        : undefined;
    if (!id || !info || !scene) return;
    const layer = buildBuildingLayer(this.engine, info, scene, world3d.EXPLODE_M);
    this.engine.content.add(layer.group);
    this.siteLayer?.setBuildingHidden(id, true);
    layer.recolor(this.shown.layer, this.shown.overlay);
    this.building = { id, layer };
  }

  /** Open the building a focus is in, or close what was open, and set how far its floors part. */
  private openBuildingFor(focus: Focus, animate: boolean): void {
    const id = this.buildingOf(focus);
    if (id !== this.building?.id) this.swapBuilding(id);
    const layer = this.building?.layer;
    if (!layer) return;
    const floor = this.floorOf(focus);
    layer.setOpenRoom(this.roomOf(focus));
    layer.setExplode(focus.kind === "building" ? 1 : 0, animate ? 700 : 0);
    const at = floor ? this.floorIndexOf(floor) : undefined;
    layer.showFloorsTo(at);
    layer.setPickFloor(focus.kind === "building" ? undefined : at);
    layer.showContainment(focus.kind !== "rack" && !this.engine.topDown);
  }

  /** Step out of the containment and look at the room again; false if the camera was not in one. */
  leaveAisle(animate = true): boolean {
    if (!this.aisle.drop()) return false;
    this.focusOn(this.current, animate);
    return true;
  }

  private roomOf(focus: Focus): string | undefined {
    if (focus.kind === "room") return focus.id;
    return focus.kind === "rack" ? this.index?.enclosing(focus.id, "room")?.id : undefined;
  }

  private floorIndexOf(floorId: string): number | undefined {
    const building = this.index?.enclosing(floorId, "building");
    if (!building || !this.index) return undefined;
    const i = builder.floorsOf(this.index, building.id).findIndex((f) => f.id === floorId);
    return i < 0 ? undefined : i;
  }

  resize(): void {
    const w = Math.max(2, this.host.clientWidth);
    const h = Math.max(2, this.host.clientHeight);
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.engine.resize(w, h);
  }

  private pickables(): THREE.Object3D[] {
    // Working inside a building, the other buildings and the yards are not what a click means.
    const inside = this.level !== undefined && this.level.kind !== "site";
    const room = this.rack.roomPicks(this.building?.layer.pickables ?? []);
    return [...(inside ? [] : (this.siteLayer?.pickables ?? [])), ...room, ...this.rack.pickables];
  }

  /** Aim the ray at a pixel of the canvas. */
  private aim(x: number, y: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.engine.view);
  }

  /** What is under a pixel of the canvas, if it is something that can be clicked. */
  pickAt(x: number, y: number): PickTag | undefined {
    this.aim(x, y);
    const hit = this.ray.intersectObjects(this.pickables(), false)[0];
    if (!hit) return undefined;
    const ids = hit.object.userData.ids as readonly string[] | undefined;
    const rack = ids && hit.instanceId !== undefined ? ids[hit.instanceId] : undefined;
    return rack ? { kind: "rack", id: rack } : pickOf(hit.object);
  }

  /** The point on the builder's plan under a pixel: where its own floor is, whatever stands in front. */
  planPointAt(x: number, y: number): world3d.PlanPt | undefined {
    const frame = this.plan;
    if (!frame) return undefined;
    this.aim(x, y);
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -frame.y);
    const hit = this.ray.ray.intersectPlane(floor, new THREE.Vector3());
    return hit ? world3d.toPlan(frame, { x: hit.x, z: hit.z }) : undefined;
  }

  /** Where a point of the builder's plan (x, height above its floor, plan y) shows on the canvas, in pixels. */
  screenOf(p: {
    x: number;
    y: number;
    z: number;
  }): { x: number; y: number; visible: boolean } | undefined {
    const frame = this.plan;
    if (!frame) return undefined;
    const at = world3d.toSite(frame, { x: p.x, y: p.z });
    const v = new THREE.Vector3(at.x, frame.y + p.y, at.z).project(this.engine.view);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height,
      visible: v.z > -1 && v.z < 1,
    };
  }

  /** The builder's plan is where it is now; follow it with `onRender`. */
  get planFrame(): world3d.PlanFrame | undefined {
    return this.plan;
  }

  /** How far the open building has lifted the floor a spot is on, metres (0 while it is closed). */
  private liftOf(spot: world3d.Spot): number {
    const open = this.building;
    return open && spot.building === open.id && spot.floor !== undefined
      ? open.layer.liftOf(spot.floor)
      : 0;
  }

  /** Show the runs at work as markers; none clears them. */
  setActivity(markers: readonly world3d.Marker[]): void {
    this.activity.set(markers);
  }

  /** Where a spot of the site, `up` pixels above its marker, shows on the canvas; follow it with `onRender`. */
  screenOfSpot(spot: world3d.Spot, up = 0): { x: number; y: number; visible: boolean } {
    const at = this.activity.place(spot);
    const v = at.clone().project(this.engine.view);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((v.x + 1) / 2) * rect.width,
      y: ((1 - v.y) / 2) * rect.height - up,
      visible: v.z > -1 && v.z < 1,
    };
  }

  /** The spot of an entity in the site as the view has it now, if it has one. */
  spotOf(id: string): world3d.Spot | undefined {
    const { index, catalog, site } = this;
    return index && catalog && site ? world3d.spotOf(index, catalog, site, id) : undefined;
  }

  /** Called after each frame that is drawn, so labels on the page can follow the camera. */
  onRender(listener: () => void): () => void {
    return this.engine.afterRender(listener);
  }

  /** Outline these boxes of the plan (the selection). */
  setSelection(boxes: readonly world3d.PlanBox[]): void {
    this.overlay.setSelection(boxes);
  }

  /** Show what the next click would build, or nothing. */
  setGhost(ghost: (world3d.PlanBox & { readonly ok: boolean }) | undefined): void {
    this.overlay.setGhost(ghost);
  }

  /** Turn slowly about what is in view (degrees a second); the viewer's own touch stops it. 0 stops it. */
  setSpin(degPerSecond: number): void {
    this.stopSpin?.();
    this.stopSpin = undefined;
    if (degPerSecond === 0 || calm()) return;
    this.stopSpin = startSpin(this.engine, this.rig, degPerSecond, () => this.setSpin(0));
  }

  /** Let a tool take the left-button drag from the camera. */
  setDragTool(tool: DragTool | undefined): void {
    this.rig.setDragTool(tool);
  }

  private click(x: number, y: number): void {
    // A person stands in front of whatever is behind them: the click is theirs.
    if (this.crew.click(x, y)) return;
    const tag = this.pickAt(x, y);
    if (!tag) return;
    this.events.onPick?.(tag);
    if (tag.kind === "device") this.rack.pick(tag.id);
    else if (!this.navigate) return;
    else if (tag.kind === "containment") {
      if (this.current.kind === "room") this.aisle.enter(tag.id);
    } else if (tag.kind === "building" || tag.kind === "room" || tag.kind === "rack")
      this.focusOn({ kind: tag.kind, id: tag.id });
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.stopSpin?.();
    this.overlay.dispose();
    this.activity.dispose();
    this.crew.dispose();
    this.rig.dispose();
    this.leaveBuilding();
    this.life?.dispose();
    this.siteLayer?.dispose();
    this.engine.dispose();
  }
}
