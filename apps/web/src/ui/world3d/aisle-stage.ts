/**
 * The camera inside a containment (REQ-006, REQ-074, ADR-0101, feedback 8): the roof and doors of the aisle clear while
 * the camera walks in to eye height, and the way out puts them back. The people of the room walk in the aisle while it
 * is looked into (`useCrew` hears of it through `onChange`). The view owns one of these, like it owns the crew stage.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex } from "@terrarium/core/world";
import { world3d } from "../../logic";
import type { BuildingLayer } from "./building-layer";
import type { Engine } from "./engine";
import type { Rig } from "./rig";
import { calm, FILL, TILT } from "./view-look";

/** The containment being looked into. */
export interface Aisle {
  readonly id: string;
  readonly name: string;
  readonly room: string;
}

/** What the stage needs from the view that owns it. */
export interface AisleHost {
  readonly engine: Engine;
  readonly rig: Rig;
  world(): { readonly index: BlueprintIndex; readonly catalog: Catalog } | undefined;
  building(): BuildingLayer | undefined;
  focus(): world3d.Focus;
  /** The aisle was entered, or left (none). */
  changed(aisle: Aisle | undefined): void;
}

/** A wider lens inside an aisle, degrees: the aisle is 1.2 m across and a long lens would see only its two walls. */
const AISLE_FOV = 62;

export class AisleStage {
  private current?: Aisle;
  private fovBefore = 34;

  constructor(private readonly host: AisleHost) {}

  get inside(): Aisle | undefined {
    return this.current;
  }

  /** Walk into a containment of the room in view: its roof and doors clear, and the camera stands in the aisle (0.6 s). */
  enter(podId: string): boolean {
    const { engine, rig } = this.host;
    const world = this.host.world();
    const layer = this.host.building();
    const focus = this.host.focus();
    if (!world || !layer || focus.kind !== "room") return false;
    const pod = world3d
      .roomScene(world.index, world.catalog, focus.id)
      ?.pods.find((p) => p.id === podId);
    const box = pod && world3d.aisleBox(world.index, world.catalog, focus.id, pod.enclosure);
    if (!pod || !box || !layer.enterPod(focus.id, podId)) return false;
    this.current = { id: podId, name: pod.name, room: focus.id };
    rig.setLimits({ minDistance: 0.3, maxDistance: 14 });
    rig.flyTo(world3d.aislePose(box), calm() ? 0 : world3d.WALK_IN_S * 1000);
    engine.setTilt(TILT.rack);
    engine.fill.intensity = FILL.rack;
    engine.setFog(120, 600);
    this.fovBefore = engine.camera.fov;
    engine.camera.fov = AISLE_FOV;
    engine.camera.updateProjectionMatrix();
    this.host.changed(this.current);
    return true;
  }

  /** Close the containment that was looked into (the camera is going somewhere else, or back); false if none was. */
  drop(): boolean {
    if (!this.current) return false;
    this.current = undefined;
    this.host.engine.camera.fov = this.fovBefore;
    this.host.engine.camera.updateProjectionMatrix();
    this.host.building()?.leavePod();
    this.host.changed(undefined);
    return true;
  }
}
