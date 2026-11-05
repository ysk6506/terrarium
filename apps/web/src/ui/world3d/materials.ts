/** Shared materials in the look of design C: matte, warm, a little grain. Made once per view. */

import type { ModelLook } from "@terrarium/core/catalog";
import * as THREE from "three";
import { world3d } from "../../logic";

const { THEME } = world3d;

import * as tex from "./textures";

const std = (
  color: string,
  roughness = 0.8,
  metalness = 0,
  extra: THREE.MeshStandardMaterialParameters = {},
) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

const FINISH: Readonly<Record<ModelLook["finish"], { roughness: number; metalness: number }>> = {
  matte: { roughness: 0.78, metalness: 0.05 },
  metal: { roughness: 0.5, metalness: 0.45 },
  glossy: { roughness: 0.3, metalness: 0.2 },
};

export class Materials {
  readonly grass: THREE.MeshStandardMaterial;
  readonly lawn: THREE.MeshStandardMaterial;
  readonly asphalt: THREE.MeshStandardMaterial;
  readonly concrete: THREE.MeshStandardMaterial;
  readonly slabSide = std(THEME.ground.slab, 0.9);
  readonly soil = std("#d8c9ae", 0.95);
  readonly mark = std("#f4f1e6", 0.9);
  readonly wall: THREE.MeshStandardMaterial;
  readonly wallLouvre: THREE.MeshStandardMaterial;
  readonly wallPlant: THREE.MeshStandardMaterial;
  readonly trim = std(THEME.building.trim, 0.85);
  readonly roof = std(THEME.building.roof, 0.8);
  readonly roofGravel: THREE.MeshStandardMaterial;
  readonly glass = std(THEME.building.glass, 0.2, 0.2, { transparent: true, opacity: 0.6 });
  readonly glassPane = std("#bfe4f2", 0.08, 0.1, {
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  /** The bare floor of a storey, drawn faintly where a room may still grow (REQ-076). */
  readonly freeFloor = std("#8fd3b6", 0.9, 0, {
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  readonly galv = std("#b4bcc6", 0.6, 0.3);
  readonly white = std("#fbf8f1", 0.8, 0);
  readonly dark = std(THEME.rack.frame, 0.5, 0.6);
  readonly steel = std("#8d99ae", 0.55, 0.5);
  readonly tower = std("#3fa59f", 0.75, 0);
  readonly generator = std("#f2b134", 0.75, 0);
  readonly transformer = std("#8d99ae", 0.75, 0);
  readonly fence = std("#8c7f6a", 0.8, 0);
  readonly supply = std(THEME.accent.cooling, 0.5, 0.1);
  readonly returning = std(THEME.accent.heat, 0.5, 0.1);
  readonly power = std(THEME.accent.power, 0.55, 0.2);
  readonly network = std(THEME.accent.network, 0.55, 0.1);
  readonly tray = std("#9aa3aa", 0.5, 0.8);
  readonly fluid = std("#a9e3df", 0.2, 0, { transparent: true, opacity: 0.72 });
  readonly plume = std("#ffffff", 1, 0, { transparent: true, opacity: 0.4 });
  readonly led = new THREE.MeshBasicMaterial({ color: "#8affc0" });
  readonly ledWarn = new THREE.MeshBasicMaterial({ color: "#ffc247" });
  readonly ledCritical = new THREE.MeshBasicMaterial({ color: "#ff5a4a" });
  readonly trunk = std("#8a6b4f", 0.9);
  readonly crown = std("#ffffff", 0.95);
  readonly paint = std("#ffffff", 0.35, 0.5);
  readonly raisedFloor: THREE.MeshStandardMaterial;
  /** Perforated epoxy floor of a cleanroom. */
  readonly cleanFloor: THREE.MeshStandardMaterial;
  /** Ribbed pale panels of a fab. */
  readonly wallFab: THREE.MeshStandardMaterial;
  /** The standing-seam blue roof that makes a fab known from the air. */
  readonly roofFab: THREE.MeshStandardMaterial;
  readonly coldTiles: THREE.MeshStandardMaterial;
  readonly rackFront: THREE.MeshStandardMaterial;
  readonly rackSide = std("#3a3f48", 0.55, 0.5);
  readonly rackSkin = std("#ffffff", 0.55, 0.3);
  readonly rackFace: THREE.MeshStandardMaterial;
  readonly tankShell = std("#ffffff", 0.45, 0.25);
  readonly tankTop: THREE.MeshStandardMaterial;
  readonly pale = std("#fbf8f1", 0.9, 0);
  readonly coilDoor: THREE.MeshStandardMaterial;
  readonly stripedLand: THREE.MeshStandardMaterial;
  /** Glass-and-panel wall of an office block, three floors to a 11.7 m tile. */
  readonly officeWall: THREE.MeshStandardMaterial;
  /** Pale wall of a dormitory slab, four floors to a 12 m tile. */
  readonly dormWall: THREE.MeshStandardMaterial;
  readonly water = std("#6fb6d4", 0.12, 0.15, { transparent: true, opacity: 0.9 });
  readonly track = std("#b4553d", 0.9);
  readonly court = std("#3f7f9e", 0.85);
  /** Bare earth of a building site. */
  readonly earth = std("#bfa57d", 0.95);
  readonly stone = std("#ddd4c0", 0.9);
  readonly stackRed = std("#c8443a", 0.6);
  readonly ghost = std("#ffffff", 0.5, 0, { transparent: true, opacity: 0.3, depthWrite: false });
  readonly cold = std("#8fd0ee", 0.2, 0, { transparent: true, opacity: 0.28, depthWrite: false });
  readonly hot = std("#f4b27a", 0.2, 0, { transparent: true, opacity: 0.28, depthWrite: false });

  private readonly cache = new Map<string, THREE.Material>();

  constructor() {
    this.grass = std("#ffffff", 1, 0, { map: grassMap(THEME.ground.grass, 512) });
    this.lawn = std("#ffffff", 1, 0, { map: grassMap(THEME.ground.lawn, 256) });
    this.asphalt = std("#ffffff", 0.95, 0, {
      map: tex.grain(THEME.ground.asphalt, 26, { size: 256 }),
    });
    this.concrete = std("#ffffff", 0.92, 0, {
      map: tex.grain(THEME.ground.concrete, 14, { size: 256, blotches: 20, seed: 3 }),
    });
    this.wall = std("#ffffff", 0.85, 0, {
      map: tex.cladding(THEME.building.wall, "#d8d0bd", false),
    });
    this.wallPlant = std("#ffffff", 0.85, 0, { map: tex.cladding("#ece6d8", "#cdc3ab", false) });
    this.wallLouvre = std("#ffffff", 0.85, 0, { map: tex.cladding("#e7e0d2", "#bfb59f", true) });
    this.roofGravel = std("#ffffff", 0.95, 0, {
      map: tex.grain("#b9bfc2", 24, { size: 128, seed: 11 }),
    });
    this.raisedFloor = std("#ffffff", 0.7, 0.05, { map: tex.tiles("#d9d3c4", "#a39b88", false) });
    this.cleanFloor = std("#ffffff", 0.55, 0.05, { map: tex.tiles("#d4e8ee", "#93afba", true) });
    this.wallFab = std("#ffffff", 0.8, 0, { map: tex.cladding("#f1f3f4", "#c3cacf", false) });
    this.roofFab = std("#ffffff", 0.55, 0.15, { map: tex.cladding("#2f6dc0", "#1f4f94", false) });
    this.officeWall = std("#ffffff", 0.5, 0.15, {
      map: tex.facade("#d4dadf", "#6f93ab", "#aab4bc", 3, 3, true),
    });
    this.dormWall = std("#ffffff", 0.7, 0.05, {
      map: tex.facade("#ece8df", "#8fa7b8", "#c9c2b4", 4, 4, false),
    });
    this.coldTiles = std("#ffffff", 0.65, 0.1, { map: tex.tiles("#b5dcec", "#7c9aa8", true) });
    this.rackFace = std("#ffffff", 0.5, 0.3, { map: tex.perforated("#ffffff", "#3b3f45") });
    this.tankTop = std("#ffffff", 0.35, 0, { map: tex.tankTop() });
    this.rackFront = std("#ffffff", 0.5, 0.35, { map: tex.perforated("#2c3138", "#0a0c0f") });
    this.coilDoor = std("#ffffff", 0.4, 0.3, { map: tex.coil("#d8eef2", "#7fb7c4") });
    this.stripedLand = std("#ffffff", 1, 0, { map: tex.stripes("#f4c7a3", "#fdeee0") });
    for (const m of [
      this.wallLouvre,
      this.roofGravel,
      this.concrete,
      this.asphalt,
      this.grass,
      this.lawn,
    ])
      if (m.map) m.map.needsUpdate = true;
  }

  /** The paint of a model: its look's body colour with the finish of the maker. */
  paintOf(look: ModelLook): THREE.MeshStandardMaterial {
    const key = `paint:${look.body}:${look.finish}`;
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!m) {
      m = std(look.body, FINISH[look.finish].roughness, FINISH[look.finish].metalness);
      this.cache.set(key, m);
    }
    return m;
  }

  /** A device's front face for its look and size in units. */
  face(look: ModelLook, units: number): THREE.MeshStandardMaterial {
    const key = `face:${look.front}:${look.body}:${look.accent}:${units}`;
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!m) {
      m = std("#ffffff", 0.5, 0.35, {
        map: tex.faceplate(look.front, look.body, look.accent, units),
      });
      this.cache.set(key, m);
    }
    return m;
  }

  /** A solid colour, shared by value. */
  solid(color: string, roughness = 0.7, metalness = 0.1): THREE.MeshStandardMaterial {
    const key = `solid:${color}:${roughness}:${metalness}`;
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!m) {
      m = std(color, roughness, metalness);
      this.cache.set(key, m);
    }
    return m;
  }

  /** A translucent, unlit-looking tint, for room floors and halos. */
  tint(color: string, opacity: number): THREE.MeshStandardMaterial {
    const key = `tint:${color}:${opacity}`;
    let m = this.cache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!m) {
      m = std(color, 0.8, 0, { transparent: true, opacity, depthWrite: false });
      this.cache.set(key, m);
    }
    return m;
  }

  dispose(): void {
    for (const value of Object.values(this)) {
      if (value instanceof THREE.Material) {
        (value as THREE.MeshStandardMaterial).map?.dispose();
        value.dispose();
      }
    }
    for (const m of this.cache.values()) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
    this.cache.clear();
  }
}

/** Grass with a little patchiness; its texture tile is 32 m on the ground. */
function grassMap(base: string, size: number): THREE.CanvasTexture {
  const t = tex.grain(base, 18, { size, blotches: 90, seed: 5 });
  t.repeat.set(1 / 32, 1 / 32);
  return t;
}
