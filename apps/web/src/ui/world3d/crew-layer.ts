/**
 * The people of one server room on screen (REQ-074, ADR-0078): engineers, a manager and a technician,
 * each role one instanced mesh, a laptop or a toolbox in their hands when they work, and an unseen box
 * round each person to click. Where each one stands comes from the pure `hallCrew.crewAt` as a function
 * of the clock and of what is the matter; this layer only writes matrices twenty times a second, and
 * only while the room is on screen. If the machine cannot keep up there are fewer people (half for each
 * level, one at least) and they are redrawn less often, but they keep walking.
 */
import * as THREE from "three";
import { hallCrew, world3d } from "../../logic";
import { CREW_SCALE, crewModelOf, desk, laptop, SHIRTS, toolbox } from "./crew-model";
import type { Engine } from "./engine";

type Role = world3d.CrewRole;
type Trouble = Pick<world3d.CrewWorld, "alarms" | "activity">;

export interface CrewLayer {
  readonly group: THREE.Group;
  /** An unseen box round each person, `userData.crew` being the person's number. */
  readonly pickables: readonly THREE.Object3D[];
  /** What is the matter now; a change starts the walks. */
  setTrouble(trouble: Trouble): void;
  /** Everyone stands (less motion asked for). */
  setStill(still: boolean): void;
  /** Where the person's head is in the world, and what they are doing. */
  head(i: number, into: THREE.Vector3): THREE.Vector3;
  stateOf(i: number): world3d.CrewState | undefined;
  dispose(): void;
}

const STEP_S = 0.05;
const HIT_W = 0.8;
const HIT_H = 2.1;

interface Scratch {
  readonly m: THREE.Matrix4;
  readonly q: THREE.Quaternion;
  readonly e: THREE.Euler;
  readonly p: THREE.Vector3;
  readonly s: THREE.Vector3;
}

interface Herd {
  readonly role: Role;
  readonly ids: readonly number[];
  readonly mesh: THREE.InstancedMesh;
}

const UNSEEN = { visible: false };

function herdsOf(crew: world3d.Crew, material: THREE.Material, into: THREE.Group): Herd[] {
  const out: Herd[] = [];
  for (const role of ["engineer", "manager", "technician"] as const) {
    const ids = crew.people.filter((p) => p.role === role).map((p) => p.id);
    if (ids.length === 0) continue;
    const model = crewModelOf(role);
    const mesh = new THREE.InstancedMesh(model.tint, material, ids.length);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    for (let i = 0; i < ids.length; i++) mesh.setColorAt(i, new THREE.Color(SHIRTS[role]));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // The parts with colours of their own share the matrices.
    const fixed = new THREE.InstancedMesh(model.fixed, material, ids.length);
    fixed.instanceMatrix = mesh.instanceMatrix;
    fixed.frustumCulled = false;
    fixed.castShadow = true;
    into.add(mesh, fixed);
    out.push({ role, ids, mesh });
  }
  return out;
}

function deskOf(crew: world3d.Crew, material: THREE.Material): THREE.Mesh | undefined {
  const d = crew.desk;
  if (!d) return undefined;
  const mesh = new THREE.Mesh(desk(d.w, d.d), material);
  mesh.position.set(d.x, crew.scene.floorY, d.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** One person at their place: walkers hop and sway, those at work crouch over the laptop, the manager sits. */
function writePerson(
  mesh: THREE.InstancedMesh,
  at: number,
  st: world3d.CrewState,
  floorY: number,
  t: number,
  k: Scratch,
): void {
  if (!st.present) {
    mesh.setMatrixAt(at, k.m.makeScale(0, 0, 0));
    return;
  }
  let lift = floorY;
  let roll = 0;
  let pitch = 0;
  let squash = 1;
  let turn = st.rot;
  if (st.pose === "walk") {
    const w = Math.sin((t + st.id) * 7);
    lift += Math.abs(w) * 0.05 * CREW_SCALE;
    roll = w * 0.08;
  } else if (st.pose === "work") {
    pitch = 0.35;
    squash = 0.8;
    turn += Math.sin(t * 0.9 + st.id) * 0.08;
  } else if (st.pose === "sit") {
    squash = 0.78;
    pitch = 0.08;
  } else {
    turn += Math.sin(t * 0.6 + st.id * 2) * 0.25;
  }
  k.q.setFromEuler(k.e.set(pitch, turn, roll));
  k.p.set(st.x, lift, st.z);
  k.s.set(CREW_SCALE, CREW_SCALE * squash, CREW_SCALE);
  mesh.setMatrixAt(at, k.m.compose(k.p, k.q, k.s));
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
/** How far in front of a person at work the laptop or the toolbox stands, metres. */
const PROP_AHEAD_M = 0.55;

interface Parts {
  readonly herds: readonly Herd[];
  readonly laptop: THREE.InstancedMesh;
  readonly toolbox: THREE.InstancedMesh;
  readonly hits: readonly THREE.Mesh[];
  readonly floorY: number;
}

/** Put the laptop or the toolbox where a person at work has it, and take it away when they are not. */
function writeProps(parts: Parts, st: world3d.CrewState, k: Scratch): void {
  const own = st.role === "technician" ? parts.toolbox : parts.laptop;
  const other = st.role === "technician" ? parts.laptop : parts.toolbox;
  other.setMatrixAt(st.id, HIDDEN);
  if (st.present && st.pose === "work" && st.role !== "manager") {
    const x = st.x + Math.sin(st.rot) * PROP_AHEAD_M;
    const z = st.z + Math.cos(st.rot) * PROP_AHEAD_M;
    k.q.setFromEuler(k.e.set(0, st.rot + Math.PI, 0));
    own.setMatrixAt(st.id, k.m.compose(k.p.set(x, parts.floorY, z), k.q, k.s.setScalar(1)));
  } else own.setMatrixAt(st.id, HIDDEN);
}

/** Write every matrix for the people at time `t`. */
function drawCrew(parts: Parts, states: readonly world3d.CrewState[], t: number, k: Scratch): void {
  for (const h of parts.herds) {
    h.ids.forEach((id, at) => {
      writePerson(h.mesh, at, states[id] as world3d.CrewState, parts.floorY, t, k);
    });
    h.mesh.instanceMatrix.needsUpdate = true;
  }
  for (const st of states) {
    writeProps(parts, st, k);
    const box = parts.hits[st.id] as THREE.Object3D;
    box.position.set(st.x, parts.floorY + HIT_H / 2, st.z);
    box.userData.present = st.present;
  }
  parts.laptop.instanceMatrix.needsUpdate = true;
  parts.toolbox.instanceMatrix.needsUpdate = true;
}

function partsOf(
  crew: world3d.Crew,
  material: THREE.Material,
  group: THREE.Group,
  hit: THREE.BufferGeometry,
): Parts {
  const make = (geo: THREE.BufferGeometry) => {
    const mesh = new THREE.InstancedMesh(geo, material, crew.people.length);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const hits = crew.people.map((p) => {
    const box = new THREE.Mesh(hit, new THREE.MeshBasicMaterial(UNSEEN));
    box.visible = false;
    box.userData.crew = p.id;
    group.add(box);
    return box;
  });
  return {
    herds: herdsOf(crew, material, group),
    laptop: make(laptop()),
    toolbox: make(toolbox()),
    hits,
    floorY: crew.scene.floorY,
  };
}

function freeParts(
  parts: Parts,
  group: THREE.Group,
  hit: THREE.BufferGeometry,
  material: THREE.Material,
): void {
  for (const h of parts.herds) h.mesh.dispose();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && mesh.geometry !== hit) mesh.geometry.dispose();
  });
  hit.dispose();
  for (const p of parts.hits) (p.material as THREE.Material).dispose();
  material.dispose();
}

export function buildCrewLayer(engine: Engine, crew: world3d.Crew, still = false): CrewLayer {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.04,
  });
  const hit = new THREE.BoxGeometry(HIT_W, HIT_H, HIT_W);
  const parts = partsOf(crew, material, group, hit);
  const furniture = deskOf(crew, material);
  if (furniture) group.add(furniture);
  const k: Scratch = {
    m: new THREE.Matrix4(),
    q: new THREE.Quaternion(),
    e: new THREE.Euler(0, 0, 0, "YXZ"),
    p: new THREE.Vector3(),
    s: new THREE.Vector3(),
  };
  let calm = still;
  let clock = 0;
  let since = 0;
  let level = 0;
  let kept = world3d.peopleKept(crew.people, level);
  let world: world3d.CrewWorld = hallCrew.NO_TROUBLE;
  let key = hallCrew.troubleKey(world);
  let states: world3d.CrewState[] = [];
  const draw = (t: number) => {
    // The people left out stand nowhere: not drawn, not to be clicked.
    states = hallCrew
      .crewAt(crew, t, world, { still: calm })
      .map((st) => (kept.has(st.id) ? st : { ...st, present: false }));
    drawCrew(parts, states, t, k);
    engine.invalidate();
  };
  const off = engine.onFrame((dt, time) => {
    clock = time;
    if (calm) return;
    since += dt;
    const now = engine.strain.level;
    if (now !== level) {
      level = now;
      kept = world3d.peopleKept(crew.people, level);
      since = Number.POSITIVE_INFINITY;
    }
    if (since < world3d.stepAt(STEP_S, level)) return;
    since = 0;
    draw(time);
  });
  draw(0);
  return {
    group,
    pickables: parts.hits,
    setTrouble: (trouble) => {
      const next = hallCrew.troubleKey(trouble);
      if (next === key) return;
      key = next;
      world = hallCrew.nextWorld(world, trouble, clock);
      draw(clock);
    },
    setStill: (on) => {
      calm = on;
      draw(clock);
    },
    head: (i, into) => {
      const st = states[i];
      group.updateWorldMatrix(true, false);
      return into
        .set(st?.x ?? 0, crew.scene.floorY + 1.95 * CREW_SCALE, st?.z ?? 0)
        .applyMatrix4(group.matrixWorld);
    },
    stateOf: (i) => states[i],
    dispose: () => {
      off();
      group.removeFromParent();
      freeParts(parts, group, hit, material);
    },
  };
}
