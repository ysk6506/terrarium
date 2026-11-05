/**
 * One rack close up (REQ-006, REQ-045, REQ-049, feedback 6): the frame with a 42-unit ruler down its rails,
 * a blank panel over every empty unit, each device with the face its kind has, and two vertical trays of
 * bundled cables. A click on a device pulls it a little out of the rack and turns the whole rack about, so its
 * back (power supplies, fans, ports, cords) faces the viewer; a second click turns it back. A rack costs a few
 * dozen draw calls however full it is, because everything still is merged by material. An immersion tank shows
 * its coolant with the servers standing in it.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import { Baker } from "./baker";
import type { Engine } from "./engine";
import { proxyBox } from "./layer";
import type { Kit } from "./parts";
import * as part from "./rack-parts";
import { tankScene } from "./rack-tank";
import { tween } from "./tween";

type Device = world3d.Device;
type RackScene = world3d.RackScene;

const { RACK_BASE_M } = world3d;
/** Metres a chosen device slides out of the rack. */
const PULL_M = 0.07;
/** How long the rack takes to turn about, ms. */
const TURN_MS = 600;
const BLUE = 0x6cc8ff;
const BLUE_DIM = 0x2f4a5c;

export interface RackState {
  /** The device pulled out, if one is. */
  readonly selected: string | undefined;
  /** Whether the back faces the viewer. */
  readonly rear: boolean;
}

export interface RackLayerOptions {
  /** Devices with activity: their network light blinks. */
  readonly busy: ReadonlySet<string>;
  /** What is wrong with devices: their power light says so. */
  readonly condition: world3d.Condition;
  readonly onChange?: (state: RackState) => void;
}

export interface RackLayer {
  readonly group: THREE.Group;
  readonly pickables: THREE.Object3D[];
  /** Where a device's front is, in the rack's own frame. */
  frontOf(deviceId: string): THREE.Vector3 | undefined;
  readonly state: RackState;
  /** A click on a device: a new one is pulled out and the back shows; the same one turns the rack back and forth. */
  pick(deviceId: string): void;
  /** What is wrong with devices changed: the power lights follow. */
  setCondition(condition: world3d.Condition): void;
  /** Put the device back and show the front. */
  clear(): void;
  dispose(): void;
}

/** The cables of a rack: power red and black, network blue. */
function cablesOf(m: Kit["m"]): part.Cables {
  return {
    red: m.solid("#d6453a", 0.6, 0.1),
    black: m.solid("#1c1e22", 0.6, 0.1),
    blue: m.solid("#3d7be0", 0.6, 0.1),
  };
}

/** The ruler down the front face of both posts: a strip the length of the rack, with the numbers on it. */
function rulers(b: Baker, k: Kit, scene: RackScene): void {
  const { units, unitM, d, w } = scene.kind;
  const geo = new THREE.PlaneGeometry(0.044, units * unitM);
  for (const sx of [-1, 1]) {
    const m = new THREE.Matrix4().makeTranslation(
      sx * (w / 2 - 0.0225),
      RACK_BASE_M + (units * unitM) / 2,
      d / 2 + 0.001,
    );
    b.add(geo, k.m.rulerPlate(units), m, { shadow: false });
  }
  geo.dispose();
}

/** Fixed parts: frame, ruler, trays, blank panels. */
function fixedParts(k: Kit, scene: RackScene, cables: part.Cables): THREE.Group {
  part.frame(k, scene);
  part.trays(k, scene, cables);
  part.blanks(k, scene);
  rulers(k.b, k, scene);
  return k.b.bake();
}

/** The proxy boxes that make each device clickable from the front and from the back. */
function proxies(scene: RackScene): {
  pickables: THREE.Mesh[];
  fronts: Map<string, THREE.Vector3>;
} {
  const pickables: THREE.Mesh[] = [];
  const fronts = new Map<string, THREE.Vector3>();
  for (const dev of scene.devices) {
    if (dev.kind === "pdu" && dev.units === 0) continue;
    const height = Math.max(1, dev.units) * scene.kind.unitM;
    const y = RACK_BASE_M + (dev.u - 1) * scene.kind.unitM + height / 2;
    fronts.set(dev.id, new THREE.Vector3(0, y, scene.kind.d / 2));
    pickables.push(
      proxyBox(
        { kind: "device", id: dev.id },
        [0, y, 0],
        [Math.min(0.5, scene.kind.w), height, scene.kind.d * 0.9],
      ),
    );
  }
  return { pickables, fronts };
}

/** The lights of the layer: two phases of blinking, and the dark of a light that is off. */
function lampsOf(): part.Lamps & { dispose(): void } {
  const make = (c: number) => new THREE.MeshBasicMaterial({ color: c });
  const lamps = { blinkA: make(BLUE), blinkB: make(BLUE_DIM), off: make(0x2a2d33) };
  return {
    ...lamps,
    dispose: () => {
      for (const m of Object.values(lamps)) m.dispose();
    },
  };
}

class Rack implements RackLayer {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Object3D[];
  private readonly pivot = new THREE.Group();
  private readonly fixed: THREE.Group;
  private readonly fronts: Map<string, THREE.Vector3>;
  private readonly lamps = lampsOf();
  private readonly cables: part.Cables;
  private readonly k: Kit;
  private devices?: THREE.Group;
  private pulled?: THREE.Group;
  private selected?: string;
  private rear = false;
  private turn = 0;
  private stopTurn = () => {};
  private readonly offFrame: () => void;
  private lit: readonly [boolean, boolean] = [true, false];

  constructor(
    private readonly engine: Engine,
    private readonly scene: RackScene,
    private opts: RackLayerOptions,
  ) {
    this.k = { b: new Baker(), m: engine.mats };
    this.cables = cablesOf(engine.mats);
    this.fixed = fixedParts(this.k, scene, this.cables);
    const found = proxies(scene);
    this.fronts = found.fronts;
    this.pickables = found.pickables;
    this.pivot.add(this.fixed, ...found.pickables);
    this.group.add(this.pivot);
    this.rebuild();
    this.offFrame = engine.onFrame((_dt, time) => this.blink(time));
  }

  get state(): RackState {
    return { selected: this.selected, rear: this.rear };
  }

  frontOf(id: string): THREE.Vector3 | undefined {
    return this.fronts.get(id);
  }

  /** Bake the devices again: all but the pulled one in one group, and that one in its own. */
  private rebuild(): void {
    this.devices?.removeFromParent();
    this.pulled?.removeFromParent();
    this.disposeGroup(this.devices);
    this.disposeGroup(this.pulled);
    const { scene } = this;
    const [pulled, rest] = [
      scene.devices.filter((d) => d.id === this.selected),
      scene.devices.filter((d) => d.id !== this.selected),
    ];
    this.devices = this.bake(rest);
    this.pulled = this.bake(pulled, true);
    this.pivot.add(this.devices, this.pulled);
    this.place();

    this.engine.invalidate();
  }

  private bake(devices: readonly Device[], marked = false): THREE.Group {
    const { b, m } = this.k;
    const kit: Kit = { b, m };
    for (const dev of devices) {
      if (dev.kind === "pdu" && dev.units === 0) {
        this.verticalPdu(kit, dev);
        continue;
      }
      const lit: part.Lights = {
        power: world3d.powerLight(dev.id, this.opts.condition),
        net: this.opts.busy.has(dev.id) ? world3d.blinkPhase(dev.id) : undefined,
        lamps: this.lamps,
      };
      part.chassis(kit, this.scene, dev);
      part.front(kit, this.scene, dev, lit);
      part.rear(kit, this.scene, dev, this.cables);
      if (marked) part.mark(kit, this.scene, dev);
    }
    return b.bake();
  }

  /** A vertical PDU hangs at the back beside the cable tray. */
  private verticalPdu(k: Kit, dev: Device): void {
    part.pdu(k, this.scene, dev);
  }

  private disposeGroup(g: THREE.Group | undefined): void {
    g?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  /** The pulled device slides toward whichever side faces the viewer. */
  private place(): void {
    this.pivot.rotation.y = this.turn;
    if (this.pulled) this.pulled.position.z = PULL_M * Math.cos(this.turn);
  }

  private blink(time: number): void {
    const steady =
      this.engine.strain.level > 0 ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const next: readonly [boolean, boolean] = [
      world3d.phaseLit(0, time, steady),
      world3d.phaseLit(1, time, steady),
    ];
    if (next[0] === this.lit[0] && next[1] === this.lit[1]) return;
    this.lit = next;
    (this.lamps.blinkA as THREE.MeshBasicMaterial).color.setHex(next[0] ? BLUE : BLUE_DIM);
    (this.lamps.blinkB as THREE.MeshBasicMaterial).color.setHex(next[1] ? BLUE : BLUE_DIM);
    this.engine.invalidate();
  }

  private turnTo(rear: boolean): void {
    this.rear = rear;
    this.stopTurn();
    this.stopTurn = tween(this.engine, this.turn, rear ? Math.PI : 0, TURN_MS, (v) => {
      this.turn = v;
      this.place();
    });
    this.opts.onChange?.(this.state);
  }

  pick(id: string): void {
    if (this.selected === id) {
      this.turnTo(!this.rear);
      return;
    }
    this.selected = id;
    this.rebuild();
    this.turnTo(true);
  }

  setCondition(condition: world3d.Condition): void {
    if (condition === this.opts.condition) return;
    this.opts = { ...this.opts, condition };
    this.rebuild();
  }

  clear(): void {
    if (this.selected === undefined && !this.rear) return;
    this.selected = undefined;
    this.rebuild();
    this.turnTo(false);
  }

  dispose(): void {
    this.stopTurn();
    this.offFrame();
    this.group.removeFromParent();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.lamps.dispose();
  }
}

export function buildRackLayer(
  engine: Engine,
  scene: RackScene,
  opts: RackLayerOptions,
): RackLayer {
  if (scene.kind.form === "tank") return tankScene(engine, scene);
  return new Rack(engine, scene, opts);
}
