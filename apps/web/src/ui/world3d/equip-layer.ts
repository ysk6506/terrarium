/**
 * Equipment inside a room: air handlers, in-row coolers, coolant distribution units, UPS cabinets and
 * switchgear. Each is a cabinet in its maker's paint with the details that tell it apart at a glance.
 */
import type { world3d } from "../../logic";
import { busway, cabinets, chiller, generator, type Kit, transformer, type Where } from "./parts";

type EquipBox = world3d.EquipBox;

const whereOf = (e: EquipBox): Where => ({ x: e.x, z: e.z, w: e.w, d: e.d, rot: e.rot, y: e.oy });

/** A cabinet body, with its front (toward +z) marked by a dark panel and an accent line. */
function cabinet(k: Kit, e: EquipBox, panel: number): void {
  const { b, m } = k;
  b.frame(e.x, e.z, e.rot, () => {
    b.box(m.paintOf(e.look), { x: 0, z: 0, w: e.w, d: e.d, h: e.h, y: e.oy, round: 0.1 });
    b.box(m.dark, {
      x: 0,
      z: e.d / 2 + 0.012,
      w: e.w * 0.78,
      d: 0.03,
      h: e.h * panel,
      y: e.oy + e.h * 0.12,
      shadow: false,
    });
    b.box(m.solid(e.look.accent, 0.5, 0.1), {
      x: 0,
      z: e.d / 2 + 0.016,
      w: e.w * 0.78,
      d: 0.03,
      h: 0.07,
      y: e.oy + e.h * 0.12 + e.h * panel + 0.05,
      shadow: false,
    });
  });
}

function crah(k: Kit, e: EquipBox): void {
  cabinet(k, e, 0.62);
  const { b, m } = k;
  b.frame(e.x, e.z, e.rot, () => {
    for (const dx of [-0.25, 0.25])
      b.cyl(m.dark, {
        x: e.w * dx,
        z: 0,
        r: Math.min(e.w, e.d) * 0.2,
        h: 0.08,
        y: e.oy + e.h,
        seg: 20,
      });
  });
}

function inrow(k: Kit, e: EquipBox): void {
  cabinet(k, e, 0.78);
  const { b, m } = k;
  b.frame(e.x, e.z, e.rot, () => {
    b.box(m.led, {
      x: e.w * 0.3,
      z: e.d / 2 + 0.02,
      w: 0.05,
      d: 0.02,
      h: 0.05,
      y: e.oy + e.h * 0.9,
      shadow: false,
    });
  });
}

function cdu(k: Kit, e: EquipBox): void {
  cabinet(k, e, 0.5);
  const { b, m } = k;
  b.frame(e.x, e.z, e.rot, () => {
    b.box(m.glass, {
      x: e.w * 0.18,
      z: e.d / 2 + 0.03,
      w: 0.32,
      d: 0.02,
      h: 0.2,
      y: e.oy + e.h * 0.72,
      shadow: false,
    });
    b.cyl(m.supply, { x: -e.w * 0.3, z: -e.d * 0.3, r: 0.07, h: 0.5, y: e.oy + e.h });
    b.cyl(m.returning, { x: e.w * 0.3, z: -e.d * 0.3, r: 0.07, h: 0.5, y: e.oy + e.h });
  });
}

function ups(k: Kit, e: EquipBox): void {
  cabinet(k, e, 0.7);
  const { b, m } = k;
  b.frame(e.x, e.z, e.rot, () => {
    for (let i = 0; i < 5; i++)
      b.box(m.dark, {
        x: (i - 2) * e.w * 0.14,
        z: e.d / 2 + 0.02,
        w: 0.03,
        d: 0.02,
        h: e.h * 0.4,
        y: e.oy + e.h * 0.25,
        shadow: false,
      });
  });
}

const BUILDERS: Readonly<Record<string, (k: Kit, e: EquipBox) => void>> = {
  crah,
  inrow,
  cdu,
  ups,
  switchgear: (k, e) => cabinets(k, whereOf(e), e.look),
  ats: (k, e) => cabinets(k, whereOf(e), e.look),
  panel: (k, e) => cabinets(k, whereOf(e), e.look),
  transformer: (k, e) => transformer(k, whereOf(e), e.look),
  chiller: (k, e) => chiller(k, whereOf(e), e.look),
  generator: (k, e) => generator(k, whereOf(e), e.look),
  busway: (k, e) => busway(k, whereOf(e)),
};

/** Draw a piece of equipment standing in a room, in the room's frame. */
export function indoorEquip(k: Kit, e: EquipBox): void {
  (BUILDERS[e.style] ?? ((kit, box) => cabinet(kit, box, 0.6)))(k, e);
}
