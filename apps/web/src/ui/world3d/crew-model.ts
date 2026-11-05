/**
 * The people of the server room as low-poly toys, built like the people of the site (`critters.ts`):
 * one geometry for each role, its shirt taking the colour of the instance. Engineers wear navy, the
 * manager grey, the technician an orange vest and a helmet. A laptop and a toolbox are the props.
 */
import type * as THREE from "three";
import type { world3d } from "../../logic";
import { eyes, HAIR, type Model, Parts, SKIN } from "./critters";

type Role = world3d.CrewRole;

/** How much bigger than life they are drawn, so they can be seen among racks. */
export const CREW_SCALE = 1.15;

export const SHIRTS: Readonly<Record<Role, string>> = {
  engineer: "#24407a",
  manager: "#8a8f98",
  technician: "#f08a24",
};

const TROUSERS: Readonly<Record<Role, string>> = {
  engineer: "#1f2a44",
  manager: "#4a4f57",
  technician: "#3b3f46",
};

function body(role: Role): Parts {
  const p = new Parts();
  const legs = TROUSERS[role];
  p.box(0.16, 0.8, 0.2, [-0.12, 0, 0], legs).box(0.16, 0.8, 0.2, [0.12, 0, 0], legs);
  p.box(0.46, 0.62, 0.28, [0, 0.8, 0])
    .box(0.12, 0.55, 0.14, [-0.3, 0.82, 0])
    .box(0.12, 0.55, 0.14, [0.3, 0.82, 0]);
  p.ball(0.25, [0, 1.68, 0], SKIN);
  eyes(p, { y: 1.66, z: 0.24, gap: 0.18, size: 0.06 });
  return p;
}

function engineer(): Model {
  const p = body("engineer");
  p.ball(0.26, [0, 1.76, -0.03], HAIR, 0.8);
  // A badge on a lanyard.
  p.box(0.1, 0.13, 0.03, [0.08, 0.98, 0.15], "#e9ecef");
  return p.build(CREW_SCALE, [SHIRTS.engineer]);
}

function manager(): Model {
  const p = body("manager");
  p.ball(0.26, [0, 1.76, -0.03], "#6b625a", 0.8);
  // A tie.
  p.box(0.07, 0.4, 0.03, [0, 0.9, 0.15], "#3a3f48");
  return p.build(CREW_SCALE, [SHIRTS.manager]);
}

function technician(): Model {
  const p = body("technician");
  p.ball(0.29, [0, 1.8, -0.01], "#f2c744", 0.7);
  p.box(0.48, 0.07, 0.3, [0, 1.0, 0], "#e8e6c8");
  return p.build(CREW_SCALE, [SHIRTS.technician]);
}

const MODELS: Readonly<Record<Role, () => Model>> = { engineer, manager, technician };

export const crewModelOf = (role: Role): Model => MODELS[role]();

/** A laptop opened toward the person who works on it, standing on the floor in front of them. */
export function laptop(): THREE.BufferGeometry {
  const p = new Parts();
  p.box(0.34, 0.03, 0.24, [0, 0.42, 0], "#aab2bb").box(
    0.34,
    0.24,
    0.02,
    [0, 0.45, 0.11],
    "#2b3138",
  );
  p.box(0.3, 0.2, 0.02, [0, 0.47, 0.1], "#4aa3ff");
  p.box(0.06, 0.4, 0.06, [0, 0, 0], "#6c737a");
  return p.build(1, ["#ffffff"]).fixed;
}

/** A toolbox for the technician. */
export function toolbox(): THREE.BufferGeometry {
  const p = new Parts();
  p.box(0.44, 0.22, 0.24, [0, 0, 0], "#d9453a").box(0.3, 0.05, 0.05, [0, 0.22, 0], "#2b3138");
  return p.build(1, ["#ffffff"]).fixed;
}

/** A desk with a screen and a chair, for the control room. */
export function desk(w: number, d: number): THREE.BufferGeometry {
  const p = new Parts();
  p.box(w, 0.06, d, [0, 0.72, 0], "#b79d7a").box(0.06, 0.72, d, [-w / 2 + 0.05, 0, 0], "#8d775b");
  p.box(0.06, 0.72, d, [w / 2 - 0.05, 0, 0], "#8d775b");
  p.box(0.6, 0.38, 0.04, [0, 0.8, -0.1], "#2b3138").box(
    0.54,
    0.32,
    0.03,
    [0, 0.83, -0.08],
    "#4aa3ff",
  );
  p.box(0.1, 0.1, 0.1, [0, 0.78, -0.1], "#2b3138");
  p.box(0.46, 0.06, 0.46, [0, 0.44, d / 2 + 0.38], "#3a3f48").box(
    0.46,
    0.4,
    0.05,
    [0, 0.5, d / 2 + 0.62],
    "#3a3f48",
  );
  p.box(0.06, 0.44, 0.06, [0, 0, d / 2 + 0.38], "#2b3138");
  return p.build(1, ["#ffffff"]).fixed;
}
