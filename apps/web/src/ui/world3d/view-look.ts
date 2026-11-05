/** How the 3D view is lit, blurred and moved at each level, and whether the person asked for less motion. */
import type { world3d } from "../../logic";

type Focus = world3d.Focus;

/** People who asked their system for less motion get the visitors standing still and arrows that do not move. */
export const calm = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The spin is drawn this often, seconds: as often as the visitors move. */
export const SPIN_STEP_S = 0.05;

/** How blurred the far and near parts are at each level: a miniature seen from close by. */
export const TILT: Readonly<Record<Focus["kind"], number>> = {
  site: 2.2,
  building: 1.6,
  floor: 1.3,
  room: 1.0,
  rack: 0.25,
};

/** The lamp that rides with the camera: off outdoors, a little in a room, strong beside a rack so its devices can be read. */
export const FILL: Readonly<Record<Focus["kind"], number>> = {
  site: 0,
  building: 0,
  floor: 4,
  room: 10,
  rack: 30,
};

/** The wall behind a rack in view: a soft grey-blue, so the devices stand out and nothing of the yard shows. */
export const ROOM_WALL = "#aab3bc";
