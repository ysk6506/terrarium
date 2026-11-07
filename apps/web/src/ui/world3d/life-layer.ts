/**
 * The little visitors of a site on screen (REQ-006, REQ-036): cars, trucks, tankers, people, cats,
 * water deer and raccoon dogs, each kind drawn as one instanced mesh so a hundred of them cost about
 * a dozen draw calls. Where each one stands comes from the pure `world3d.life` module as a function of
 * time; this layer only writes the matrices, twenty times a second, and only while someone can see them.
 * If the machine cannot keep up there are fewer of them (half for each level, one of a kind at least) and they
 * are redrawn less often, but they keep moving.
 */
import * as THREE from "three";
import { world3d } from "../../logic";
import { BIRD_WING_AT, birdWing, CAT_TAIL_AT, catTail, type Model, modelOf } from "./critters";
import type { Engine } from "./engine";

type Agent = world3d.Agent;
type LifeKind = world3d.LifeKind;

/**
 * on: always moving, all of them. auto: moving, fewer of them when frames get slow. still: standing where they were
 * at the start (for people who asked the system for less motion). off: nobody.
 */
export type LifeMode = "on" | "auto" | "still" | "off";

export interface LifeLayer {
  readonly group: THREE.Group;
  /** How many visitors there are. */
  readonly count: number;
  /** The cats and birds that can be clicked now, with where each one is (its head, in the site's frame). */
  animals(): ReadonlyArray<{
    readonly id: number;
    readonly kind: world3d.ReactiveKind;
    readonly at: THREE.Vector3;
  }>;
  /**
   * Answer a click on a cat or a bird (REQ-105): it plays its reaction, then goes on with its day where it left off.
   * With `calm` nothing moves. Returns false when there is no such animal.
   */
  poke(id: number, calm: boolean): boolean;
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
  bird: { stride: 6, hop: 0.2, sway: 0.1 },
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
  /** Parts that move on their own (a cat's tail, a bird's wings), hinged on the body. */
  readonly limbs: readonly Limb[];
}

/** A part hinged at `at` on the body's frame, swung about `axis` by the animal's tail or wing angle. */
interface Limb {
  readonly mesh: THREE.InstancedMesh;
  readonly at: readonly [number, number, number];
  readonly axis: "y" | "z";
  readonly angle: (swing: Swing) => number;
}

interface Swing {
  readonly tail: number;
  readonly flap: number;
}

interface Scratch {
  readonly m: THREE.Matrix4;
  readonly q: THREE.Quaternion;
  readonly e: THREE.Euler;
  readonly p: THREE.Vector3;
  readonly s: THREE.Vector3;
  readonly h: THREE.Matrix4;
  readonly r: THREE.Matrix4;
  readonly head: THREE.Vector3;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const GONE = new THREE.Matrix4().makeScale(0, 0, 0);

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
  const paint = (mesh: THREE.InstancedMesh) => {
    for (const [i, a] of agents.entries()) mesh.setColorAt(i, toneOf(model, a.tone));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  if (tint) paint(tint);
  const limbs: Limb[] = [];
  const limb = (m: Model, at: Limb["at"], axis: Limb["axis"], angle: Limb["angle"]) => {
    const mesh = make(m.tint);
    if (!mesh) return;
    paint(mesh);
    limbs.push({ mesh, at, axis, angle });
  };
  if (kind === "cat") limb(catTail(), CAT_TAIL_AT, "y", (s) => s.tail);
  if (kind === "bird")
    for (const side of [1, -1] as const)
      limb(birdWing(side), [side * BIRD_WING_AT[0], BIRD_WING_AT[1], 0], "z", (s) => side * s.flap);
  return { agents, model, lead, meshes, lift: world3d.isVehicle(kind) ? ROAD_LIFT_M : 0, limbs };
}

/** Put one visitor where it is at time `t`: walking animals hop and sway, resting ones look around. */
function writePose(
  herd: Herd,
  i: number,
  t: number,
  k: Scratch,
  react: world3d.Reactions,
): THREE.Vector3 {
  const a = herd.agents[i] as Agent;
  const pose = react.placed(a, t);
  const gait = GAIT[a.kind];
  const scale = herd.model.scale;
  let lift = herd.lift + pose.y;
  let roll = 0;
  let turn = pose.rot;
  if (gait && pose.moving) {
    const w = Math.sin(pose.phase * gait.stride);
    lift += Math.abs(w) * gait.hop * scale;
    roll = w * gait.sway;
  } else if (gait && !pose.answering) {
    turn += Math.sin(t * 0.7 + a.id) * 0.45;
  }
  // A sitting cat tips back onto its haunches and drops a little.
  const pitch = pose.pitch - pose.sit * 0.6;
  lift -= pose.sit * 0.05 * scale;
  k.p.set(pose.x, lift, pose.z);
  k.q.setFromEuler(k.e.set(pitch, turn, roll));
  k.s.setScalar(scale);
  herd.lead.setMatrixAt(i, k.m.compose(k.p, k.q, k.s));
  const swing = { tail: pose.tail || Math.sin(t * 1.5 + a.id) * 0.15, flap: pose.flap };
  for (const l of herd.limbs) {
    k.m.compose(k.p, k.q, k.s);
    k.h.makeTranslation(l.at[0], l.at[1], l.at[2]);
    k.r.makeRotationAxis(l.axis === "y" ? Y_AXIS : Z_AXIS, l.angle(swing));
    l.mesh.setMatrixAt(i, k.m.multiply(k.h).multiply(k.r));
  }
  return k.head.set(pose.x, lift + 0.36 * scale, pose.z);
}

function herdsFor(agents: readonly Agent[], material: THREE.Material, into: THREE.Group): Herd[] {
  const byKind = new Map<LifeKind, Agent[]>();
  for (const a of agents) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  return [...byKind].map(([kind, list]) => herdOf(kind, list, material, into));
}

interface Answering {
  readonly agents: readonly Agent[];
  readonly spots: ReadonlyMap<number, THREE.Vector3>;
  readonly react: world3d.Reactions;
  readonly live: () => boolean;
  readonly redraw: () => void;
  readonly now: () => number;
}

/** The part of the layer that cats and birds answer clicks with. */
function animalAnswers(o: Answering): Pick<LifeLayer, "animals" | "poke"> {
  return {
    animals: () =>
      o.live()
        ? [...o.spots].flatMap(([id, at]) => {
            const kind = o.agents[id]?.kind;
            return kind === "cat" || kind === "bird" ? [{ id, kind, at }] : [];
          })
        : [],
    poke: (id, calm) => {
      const a = o.agents[id];
      if (!a || !o.spots.has(id) || !o.live()) return false;
      const ok = o.react.start(a, o.now(), calm);
      if (ok) o.redraw();
      return ok;
    },
  };
}

interface DrawSet {
  readonly herds: readonly Herd[];
  readonly level: number;
  readonly scratch: Scratch;
  readonly react: world3d.Reactions;
  /** Where each cat and bird is now, for clicks; the ones left out at this level are not in it. */
  readonly spots: Map<number, THREE.Vector3>;
}

/** Write every visitor's matrices for time `t`; the ones left out at this level are drawn at no size, one of each kind always stays. */
function drawHerds(set: DrawSet, t: number): void {
  const { herds, level, scratch, react, spots } = set;
  for (const h of herds) {
    const kept = world3d.shownAt(h.agents.length, level);
    const first = h.agents[0]?.kind;
    const reactive = first === "cat" || first === "bird";
    for (let i = 0; i < h.agents.length; i++) {
      const id = (h.agents[i] as Agent).id;
      if (i < kept) {
        const head = writePose(h, i, t, scratch, react);
        if (reactive) spots.set(id, (spots.get(id) ?? new THREE.Vector3()).copy(head));
      } else {
        h.lead.setMatrixAt(i, GONE);
        for (const l of h.limbs) l.mesh.setMatrixAt(i, GONE);
        spots.delete(id);
      }
    }
    h.lead.instanceMatrix.needsUpdate = true;
    for (const l of h.limbs) l.mesh.instanceMatrix.needsUpdate = true;
  }
}

const newScratch = (): Scratch => ({
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  e: new THREE.Euler(0, 0, 0, "YXZ"),
  p: new THREE.Vector3(),
  s: new THREE.Vector3(),
  h: new THREE.Matrix4(),
  r: new THREE.Matrix4(),
  head: new THREE.Vector3(),
});

export function buildLifeLayer(engine: Engine, site: world3d.SiteScene): LifeLayer {
  const group = new THREE.Group();
  group.visible = false;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.04,
  });
  const agents = world3d.lifeOf(site);
  const herds = herdsFor(agents, material, group);
  const scratch = newScratch();
  let shown = false;
  let level = 0;
  let mode: LifeMode = "auto";
  let clock = 0;
  let since = 0;

  const live = () => shown && mode !== "off";
  const react = new world3d.Reactions(site.plan);
  const spots = new Map<number, THREE.Vector3>();
  const draw = (t: number) => {
    drawHerds({ herds, level, scratch, react, spots }, t);
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
    // While one answers a click it is drawn on every frame, so the stretch and the flight are smooth.
    if (react.busy) since = Number.POSITIVE_INFINITY;
    else since += dt;
    const now = mode === "auto" ? engine.strain.level : 0;
    if (now !== level) {
      level = now;
      since = Number.POSITIVE_INFINITY;
    }
    if (since < world3d.stepAt(STEP_S, level)) return;
    since = 0;
    draw(time);
  });

  const answers = animalAnswers({
    agents,
    spots,
    react,
    live,
    redraw: () => draw(mode === "still" ? 0 : clock),
    now: () => clock,
  });

  return {
    group,
    count: agents.length,
    ...answers,
    setShown: (on) => {
      if (on === shown) return;
      shown = on;
      sync();
    },
    setMode: (next) => {
      mode = next;
      sync();
    },
    dispose: () => {
      off();
      group.removeFromParent();
      for (const h of herds) {
        for (const mesh of h.meshes) mesh.geometry.dispose();
        h.lead.dispose();
        for (const l of h.limbs) l.mesh.dispose();
      }
      material.dispose();
    },
  };
}
