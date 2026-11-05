/**
 * The rack in view as the 3D view holds it (REQ-006, feedback 6): one detailed rack layer mounted where the rack
 * stands, with the racks in front of it and beside it cleared, made when the focus is a rack and dropped when it
 * is not. A click on a device pulls it out and turns the rack about; Esc puts it back.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintIndex } from "@terrarium/core/world";
import type * as THREE from "three";
import { world3d } from "../../logic";
import type { BuildingLayer } from "./building-layer";
import type { Engine } from "./engine";
import { buildRackLayer, type RackLayer, type RackState } from "./rack-layer";

/** What the stage needs from the view that owns it. */
export interface RackHost {
  readonly engine: Engine;
  world(): { readonly index: BlueprintIndex; readonly catalog: Catalog } | undefined;
  building(): BuildingLayer | undefined;
  /** What is wrong with devices now: their power lights follow. */
  condition(): world3d.Condition;
  changed(state: RackState): void;
}

interface Open {
  readonly id: string;
  readonly layer: RackLayer;
  /** Where the rack faces in world space, radians: the camera turns with it. */
  readonly facing: number;
  readonly restore: () => void;
}

export class RackStage {
  private open?: Open;

  constructor(private readonly host: RackHost) {}

  /** How far the rack in view is turned from the usual way of looking, radians (0 when none is open). */
  get facing(): number {
    return this.open?.facing ?? 0;
  }

  get state(): RackState | undefined {
    return this.open?.layer.state;
  }

  get pickables(): readonly THREE.Object3D[] {
    return this.open?.layer.pickables ?? [];
  }

  /** Draw the rack the focus is on in detail, and take the last one away. */
  sync(focus: world3d.Focus): void {
    const wanted = focus.kind === "rack" ? focus.id : undefined;
    if (wanted === this.open?.id) return;
    this.close();
    const world = this.host.world();
    const building = this.host.building();
    const scene =
      wanted && world ? world3d.rackScene(world.index, world.catalog, wanted) : undefined;
    if (!wanted || !scene || !world || !building) return;
    const layer = buildRackLayer(this.host.engine, scene, {
      busy: world3d.busyDevices(world.index, scene),
      condition: this.host.condition(),
      onChange: (s) => this.host.changed(s),
    });
    const facing = building.mountOnRack(wanted, layer.group);
    if (facing === undefined) {
      layer.dispose();
      return;
    }
    building.setRackHidden(wanted, true);
    this.open = { id: wanted, layer, facing, restore: building.clearFrontOf(wanted) };
  }

  /** At a rack the containment and the machines round it are not what a click means: its devices are. */
  roomPicks(objects: readonly THREE.Object3D[]): readonly THREE.Object3D[] {
    if (!this.open) return objects;
    return objects.filter((o) => {
      const kind = (o.userData.pick as { kind?: string } | undefined)?.kind;
      return kind !== "containment" && kind !== "equipment";
    });
  }

  /** A click on a device of the rack. */
  pick(deviceId: string): void {
    this.open?.layer.pick(deviceId);
  }

  setCondition(condition: world3d.Condition): void {
    this.open?.layer.setCondition(condition);
  }

  /** Put the pulled-out device back and turn the rack to face the viewer; false if there was nothing to undo. */
  clear(): boolean {
    const layer = this.open?.layer;
    if (!layer || (layer.state.selected === undefined && !layer.state.rear)) return false;
    layer.clear();
    return true;
  }

  /** Let go of the rack: the ones cleared round it come back. */
  close(): void {
    const open = this.open;
    if (!open) return;
    this.open = undefined;
    open.restore();
    this.host.building()?.setRackHidden(open.id, false);
    open.layer.dispose();
  }
}
