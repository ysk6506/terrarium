/**
 * The little visitors of a site on screen (REQ-006, REQ-036): cars, trucks, tankers, people, cats,
 * water deer and raccoon dogs, each kind drawn as one instanced mesh so a hundred of them cost about
 * a dozen draw calls. Where each one stands comes from the pure `world3d.life` module as a function of
 * time; this layer only writes the matrices, twenty times a second, and only while someone can see them.
 * If the machine cannot keep up it switches itself off rather than make the rest of the view stutter.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import { type Model, modelOf } from "./critters";
import type { Engine } from "./engine";
import { Strain } from "./strain";

type Agent = world3d.Agent;
type LifeKind = world3d.LifeKind;

/**
 * on: always moving. auto: moving, but gives up when frames get slow. still: standing where they were
 * at the start (for people who asked the system for less motion). off: nobody.
 */
export type LifeMode = "on" | "auto" | "still" | "off";

export interface LifeLayer {
  readonly group: THREE.Group;
  /** How many visitors there are. */
  readonly count: number;
  /** Whether the view is at a level where they can be seen. */
  setShown(on: boolean): void;
  setMode(mode: LifeMode): void;
  dispose(): void;
}

/** Seconds between two updates of the positions. */
const STEP_S = 0.05;
/** Vehicles drive on the road surface, a little above the grass. */
const ROAD_LIFT_M = 0.12;

interface Gait {
  /** Radians of stride per metre walked. */
  readonly stride: number;
  /** How high a step lifts, as a share of the model's size. */
  readonly hop: number;
  /** How far the body rolls from side to side, radians. */
  readonly sway: number;
}

const GAIT: Readonly<Partial<Record<LifeKind, Gait>>> = {
  person: { stride: 3.6, hop: 0.05, sway: 0.1 },
  cat: { stride: 5, hop: 0.07, sway: 0.06 },
  deer: { stride: 2.4, hop: 0.12, sway: 0.04 },
  raccoon: { stride: 4.2, hop: 0.06, sway: 0.09 },
};

interface Herd {
  readonly agents: readonly Agent[];
  readonly model: Model;
  /** The mesh whose matrices are written; the others share them. */
  readonly lead: THREE.InstancedMesh;
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly lift: number;
}

interface Scratch {
  readonly m: THREE.Matrix4;
  readonly q: THREE.Quaternion;
  readonly e: THREE.Euler;
  readonly p: THREE.Vector3;
  readonly s: THREE.Vector3;
}

const toneOf = (model: Model, tone: number): THREE.Color =>
  model.tones[
    Math.min(model.tones.length - 1, Math.floor(tone * model.tones.length))
  ] as THREE.Color;

function herdOf(
  kind: LifeKind,
  agents: readonly Agent[],
  material: THREE.Material,
  into: THREE.Group,
): Herd {
  const model = modelOf(kind);
  const meshes: THREE.InstancedMesh[] = [];
  const make = (geo: THREE.BufferGeometry, share?: THREE.InstancedMesh) => {
    if (!geo.getAttribute("position")) return undefined;
    const mesh = new THREE.InstancedMesh(geo, material, agents.length);
    if (share) mesh.instanceMatrix = share.instanceMatrix;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    into.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const tint = make(model.tint);
  const fixed = make(model.fixed, tint);
  const lead = (tint ?? fixed) as THREE.InstancedMesh;
  if (tint) {
    for (const [i, a] of agents.entries()) tint.setColorAt(i, toneOf(model, a.tone));
    if (tint.instanceColor) tint.instanceColor.needsUpdate = true;
  }
  return {
    agents,
    model,
    lead,
    meshes,
    lift: world3d.isVehicle(kind) ? ROAD_LIFT_M : 0,
  };
}

/** Put one visitor where it is at time `t`: walking animals hop and sway, resting ones look around. */
function writePose(herd: Herd, i: number, t: number, k: Scratch): void {
  const a = herd.agents[i] as Agent;
  const pose = world3d.lifePoseAt(a, t);
  const gait = GAIT[a.kind];
  const scale = herd.model.scale;
  let lift = herd.lift;
  let roll = 0;
  let turn = pose.rot;
  if (gait && pose.moving) {
    const w = Math.sin(pose.phase * gait.stride);
    lift += Math.abs(w) * gait.hop * scale;
    roll = w * gait.sway;
  } else if (gait) {
    turn += Math.sin(t * 0.7 + a.id) * 0.45;
  }
  k.p.set(pose.x, lift, pose.z);
  k.q.setFromEuler(k.e.set(0, turn, roll));
  k.s.setScalar(scale);
  herd.lead.setMatrixAt(i, k.m.compose(k.p, k.q, k.s));
}

function herdsFor(agents: readonly Agent[], material: THREE.Material, into: THREE.Group): Herd[] {
  const byKind = new Map<LifeKind, Agent[]>();
  for (const a of agents) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  return [...byKind].map(([kind, list]) => herdOf(kind, list, material, into));
}

export function buildLifeLayer(
  engine: Engine,
  site: world3d.SiteScene,
  onSlow: () => void,
): LifeLayer {
  const group = new THREE.Group();
  group.visible = false;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.04,
  });
  const agents = world3d.lifeOf(site);
  const herds = herdsFor(agents, material, group);
  const scratch: Scratch = {
    m: new THREE.Matrix4(),
    q: new THREE.Quaternion(),
    e: new THREE.Euler(0, 0, 0, "YXZ"),
    p: new THREE.Vector3(),
    s: new THREE.Vector3(),
  };
  const strain = new Strain();
  let shown = false;
  let mode: LifeMode = "auto";
  let clock = 0;
  let since = 0;

  const live = () => shown && mode !== "off";
  const draw = (t: number) => {
    for (const h of herds) {
      for (let i = 0; i < h.agents.length; i++) writePose(h, i, t, scratch);
      h.lead.instanceMatrix.needsUpdate = true;
    }
    engine.invalidate();
  };
  const sync = () => {
    group.visible = live();
    if (live()) draw(mode === "still" ? 0 : clock);
    else engine.invalidate();
  };

  const off = engine.onFrame((dt, time) => {
    clock = time;
    if (!live() || mode === "still") return;
    since += dt;
    if (mode === "auto" && strain.frame(dt)) {
      mode = "off";
      sync();
      onSlow();
      return;
    }
    if (since < STEP_S) return;
    since = 0;
    draw(time);
  });

  return {
    group,
    count: agents.length,
    setShown: (on) => {
      if (on === shown) return;
      shown = on;
      sync();
    },
    setMode: (next) => {
      mode = next;
      strain.reset();
      sync();
    },
    dispose: () => {
      off();
      group.removeFromParent();
      for (const h of herds) {
        for (const mesh of h.meshes) mesh.geometry.dispose();
        h.lead.dispose();
      }
      material.dispose();
    },
  };
}
