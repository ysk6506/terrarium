/**
 * The pieces of a rack scene, drawn as boxes that the Baker merges by material (REQ-006, REQ-045, REQ-049,
 * feedback 6): the frame with its two vertical cable trays, a blank panel over every empty unit, and for each
 * device the face its kind has on the front (bezel, drive bays, grille, ports, lights) and the back it has
 * behind (power supplies, fans, network ports, cords into the trays). A full rack is a few dozen meshes,
 * not a few thousand, because nothing here is drawn one cable at a time.
 */
import type { Material } from "three";
import { world3d } from "../../logic";
import type { Baker } from "./baker";
import type { Kit } from "./parts";

type Device = world3d.Device;
type RackScene = world3d.RackScene;

const { RACK_BASE_M } = world3d;
const POST_M = 0.045;
/** The width of the gear between the rails, metres. */
const RAIL_W_M = 0.482;
/** Metres a device is set back from the front rail. */
const SETBACK_M = 0.08;

/** The lights of a rack that belong to the layer, not the shared materials: two phases of blinking, and the dark of a light that is off. */
export interface Lamps {
  readonly blinkA: Material;
  readonly blinkB: Material;
  readonly off: Material;
}

/** Where a device sits in the rack's frame. */
export interface Slot {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly y: number;
  /** Front and back faces of the body (z). */
  readonly front: number;
  readonly back: number;
}

export function slotOf(scene: RackScene, dev: Device): Slot {
  const { w, d, unitM } = scene.kind;
  const depth = d * 0.82;
  const front = d / 2 - SETBACK_M;
  return {
    width: Math.min(RAIL_W_M, w - 0.1),
    depth,
    height: Math.max(1, dev.units) * unitM - 0.004,
    y: RACK_BASE_M + (dev.u - 1) * unitM + 0.002,
    front,
    back: front - depth,
  };
}

/** Tray centres, metres from the middle: network on the left, power on the right, in the gap beside the gear. */
export function trayX(): { readonly net: number; readonly power: number } {
  const x = RAIL_W_M / 2 + 0.022;
  return { net: -x, power: x };
}

/** The z of the cable trays: just behind the gear. */
const trayZ = (scene: RackScene): number => -scene.kind.d / 2 + 0.07;

// --- the frame ---------------------------------------------------------------------------------

export function frame(k: Kit, scene: RackScene): void {
  const { b, m } = k;
  const { w, d, h } = scene.kind;
  b.box(m.dark, { x: 0, z: 0, w, d, h: RACK_BASE_M, round: 0.03 });
  b.box(m.dark, { x: 0, z: 0, w, d, h: 0.05, y: h - 0.05, round: 0.03 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      b.box(m.dark, {
        x: sx * (w / 2 - POST_M / 2),
        z: sz * (d / 2 - POST_M / 2),
        w: POST_M,
        d: POST_M,
        h: h - RACK_BASE_M,
        y: RACK_BASE_M,
      });
  // The mounting rails the gear is screwed to, at the front.
  for (const sx of [-1, 1])
    b.box(m.steel, {
      x: sx * (RAIL_W_M / 2 + 0.008),
      z: d / 2 - 0.07,
      w: 0.016,
      d: 0.03,
      h: h - 0.3,
      y: 0.15,
      shadow: false,
    });
}

/** Two vertical trays at the back, each with the cables of its kind bundled in it: network blue on the left, power red and black on the right. */
export function trays(k: Kit, scene: RackScene, cables: Cables): void {
  const { b, m } = k;
  const { h } = scene.kind;
  const x = trayX();
  const z = trayZ(scene);
  const height = h - 0.4;
  for (const tx of [x.net, x.power]) {
    b.box(m.steel, { x: tx, z, w: 0.04, d: 0.09, h: height, y: 0.2, shadow: false });
    b.box(m.dark, { x: tx, z: z - 0.04, w: 0.04, d: 0.01, h: height, y: 0.2, shadow: false });
  }
  const run = { z: z + 0.012, h: height - 0.04, y: 0.22, shadow: false } as const;
  b.cyl(cables.blue, { ...run, x: x.net, r: 0.013, seg: 10 });
  b.cyl(cables.red, { ...run, x: x.power - 0.009, r: 0.007, seg: 8 });
  b.cyl(cables.black, { ...run, x: x.power + 0.009, r: 0.007, seg: 8 });
}

export interface Cables {
  readonly red: Material;
  readonly black: Material;
  readonly blue: Material;
}

// --- empty units -------------------------------------------------------------------------------

/** A blank panel over every empty unit; the top unit, if empty, is the pale-blue slot kept for the top-of-rack switch. */
export function blanks(k: Kit, scene: RackScene): void {
  const { b, m } = k;
  const { unitM } = scene.kind;
  const plain = m.solid("#ddd8cc", 0.85, 0.05);
  const tor = m.solid("#b9cdea", 0.7, 0.1);
  for (const gap of world3d.gapsOf(scene))
    for (let u = gap.u; u < gap.u + gap.units; u++) {
      const top = gap.tor && u === scene.kind.units;
      b.box(top ? tor : plain, {
        x: 0,
        z: scene.kind.d / 2 - SETBACK_M + 0.004,
        w: RAIL_W_M,
        d: 0.006,
        h: unitM - 0.006,
        y: RACK_BASE_M + (u - 1) * unitM + 0.003,
        shadow: false,
      });
    }
}

/** The body of a device between the rails, front to back. */
export function chassis(k: Kit, scene: RackScene, dev: Device): void {
  const s = slotOf(scene, dev);
  k.b.box(k.m.solid("#262a30", 0.7, 0.4), {
    x: 0,
    z: (s.front + s.back) / 2,
    w: s.width,
    d: s.depth,
    h: s.height,
    y: s.y,
    round: 0.004,
  });
}

/** A frame in the accent colour round the device that is pulled out, on both faces so it is seen from either side. */
export function mark(k: Kit, scene: RackScene, dev: Device): void {
  const s = slotOf(scene, dev);
  const line = k.m.solid("#f2a516", 0.5, 0.1);
  const t = 0.004;
  for (const z of [s.front + 0.011, s.back - 0.011]) {
    for (const sy of [-1, 1])
      k.b.box(line, {
        x: 0,
        z,
        w: s.width + 0.02,
        d: 0.004,
        h: t,
        y: s.y + (sy > 0 ? s.height : -t),
        shadow: false,
      });
    for (const sx of [-1, 1])
      k.b.box(line, {
        x: sx * (s.width / 2 + 0.008),
        z,
        w: t,
        d: 0.004,
        h: s.height + 2 * t,
        y: s.y - t,
        shadow: false,
      });
  }
}

/** A vertical PDU hangs at the back beside the cable tray, with a light for each outlet. */
export function pdu(k: Kit, scene: RackScene, dev: Device): void {
  const { b, m } = k;
  const { w, d, h } = scene.kind;
  const side = dev.id.length % 2 === 0 ? -1 : 1;
  const x = side * (w / 2 - 0.1);
  b.box(m.paintOf(dev.look), {
    x,
    z: -d / 2 + 0.1,
    w: 0.05,
    d: 0.05,
    h: h * 0.7,
    y: h * 0.12,
    round: 0.01,
  });
  for (let i = 0; i < 12; i++)
    b.box(m.led, {
      x,
      z: -d / 2 + 0.13,
      w: 0.03,
      d: 0.01,
      h: 0.03,
      y: h * 0.16 + (i * (h * 0.6)) / 12,
      shadow: false,
    });
}

// --- the front of a device ---------------------------------------------------------------------

function lamp(b: Baker, mat: Material, x: number, z: number, y: number, size = 0.007): void {
  b.box(mat, { x, z, w: size, d: 0.004, h: size, y, shadow: false });
}

/** The face of one device: bezel plate, then what its kind has on it, then the two lights at the right. */
export function front(k: Kit, scene: RackScene, dev: Device, lit: Lights): void {
  const { b, m } = k;
  const s = slotOf(scene, dev);
  const spec = world3d.frontOf(dev);
  const z = s.front + 0.004;
  b.box(m.solid(spec.bezel, 0.5, 0.4), {
    x: 0,
    z,
    w: s.width,
    d: 0.008,
    h: s.height,
    y: s.y,
    round: 0.003,
  });
  const bay = m.solid("#0d0f12", 0.9, 0.1);
  const zf = s.front + 0.0085;
  const left = -s.width / 2 + 0.018;
  const span = s.width - 0.115;
  for (let r = 0; r < spec.bays.rows; r++)
    for (let c = 0; c < spec.bays.cols; c++) {
      const cw = span / spec.bays.cols;
      const rh = (s.height - 0.008) / spec.bays.rows;
      b.box(bay, {
        x: left + (c + 0.5) * cw,
        z: zf,
        w: cw * 0.8,
        d: 0.004,
        h: rh * 0.72,
        y: s.y + 0.004 + r * rh + rh * 0.14,
        shadow: false,
      });
    }
  for (let i = 0; i < spec.grille; i++)
    b.box(bay, {
      x: left + span / 2,
      z: zf,
      w: span,
      d: 0.004,
      h: 0.0035,
      y: s.y + ((i + 1) * s.height) / (spec.grille + 1),
      shadow: false,
    });
  if (spec.cls === "gpu")
    b.box(m.solid("#3fc7b0", 0.5, 0.2), {
      x: left + span / 2,
      z: zf,
      w: span,
      d: 0.004,
      h: 0.004,
      y: s.y + 0.004,
      shadow: false,
    });
  if (spec.ports > 0) ports(k, s, spec.ports, lit.power !== "off");
  lights(k, s, lit);
}

function ports(k: Kit, s: Slot, count: number, linked: boolean): void {
  const { b, m } = k;
  const bay = m.solid("#0d0f12", 0.9, 0.1);
  const rows = count > 24 ? 2 : 1;
  const perRow = Math.min(24, count);
  const span = s.width - 0.12;
  const pw = span / perRow;
  for (let r = 0; r < rows; r++)
    for (let i = 0; i < perRow; i++) {
      const x = -s.width / 2 + 0.018 + (i + 0.5) * pw;
      const y = s.y + 0.005 + (r * (s.height - 0.01)) / rows;
      b.box(bay, {
        x,
        z: s.front + 0.0085,
        w: pw * 0.72,
        d: 0.004,
        h: ((s.height - 0.012) / rows) * 0.5,
        y,
        shadow: false,
      });
      if (linked && i % 3 === 0)
        lamp(b, m.led, x, s.front + 0.0095, y + ((s.height - 0.012) / rows) * 0.55, 0.004);
    }
}

/** What the lights of one device say. */
export interface Lights {
  readonly power: world3d.PowerLight;
  /** The network light blinks: 0 or 1 says which of the two phases, undefined that it is dark. */
  readonly net: 0 | 1 | undefined;
  readonly lamps: Lamps;
}

function lights(k: Kit, s: Slot, lit: Lights): void {
  const { b, m } = k;
  const x = s.width / 2 - 0.045;
  const y = s.y + s.height * 0.62;
  const power = lit.power === "ok" ? m.led : lit.power === "warn" ? m.ledWarn : lit.lamps.off;
  lamp(b, power, x, s.front + 0.0095, y);
  const net =
    lit.net === undefined ? lit.lamps.off : lit.net === 0 ? lit.lamps.blinkA : lit.lamps.blinkB;
  lamp(b, net, x + 0.016, s.front + 0.0095, y);
  b.box(m.steel, {
    x: x + 0.008,
    z: s.front + 0.0095,
    w: 0.016,
    d: 0.004,
    h: 0.006,
    y: s.y + s.height * 0.28,
    shadow: false,
  });
}

// --- the back of a device ----------------------------------------------------------------------

/** The back: power supplies, fans, network ports, and the cords running to the trays. */
export function rear(k: Kit, scene: RackScene, dev: Device, cables: Cables): void {
  const { b, m } = k;
  const s = slotOf(scene, dev);
  const spec = world3d.rearOf(dev);
  const z = s.back - 0.004;
  b.box(m.solid("#2c3137", 0.6, 0.5), {
    x: 0,
    z,
    w: s.width,
    d: 0.008,
    h: s.height,
    y: s.y,
    round: 0.003,
  });
  const psu = m.solid("#aeb5bc", 0.4, 0.7);
  const psuW = Math.min(0.09, (s.width * 0.5) / Math.max(1, spec.psus));
  const x0 = s.width / 2 - 0.02 - psuW / 2;
  for (let i = 0; i < spec.psus; i++) {
    const x = x0 - i * (psuW + 0.004);
    b.box(psu, {
      x,
      z: z - 0.004,
      w: psuW,
      d: 0.012,
      h: s.height * 0.8,
      y: s.y + s.height * 0.1,
      shadow: false,
    });
    lamp(b, m.led, x - psuW * 0.3, z - 0.011, s.y + s.height * 0.78, 0.005);
    const red = i % 2 === 0;
    const y = s.y + s.height * (red ? 0.58 : 0.42);
    cord(k, scene, s, red ? cables.red : cables.black, { x, y, toX: trayX().power });
  }
  const bay = m.solid("#0d0f12", 0.9, 0.1);
  const left = -s.width / 2 + 0.03;
  for (let i = 0; i < spec.fans; i++)
    b.box(bay, {
      x: left + i * 0.07,
      z: z - 0.003,
      w: 0.055,
      d: 0.006,
      h: s.height * 0.7,
      y: s.y + s.height * 0.15,
      shadow: false,
    });
  for (let i = 0; i < spec.nics; i++) {
    const x = left + 0.01 + i * 0.026;
    b.box(bay, {
      x,
      z: z - 0.003,
      w: 0.02,
      d: 0.006,
      h: Math.min(0.022, s.height * 0.4),
      y: s.y + s.height * 0.3,
      shadow: false,
    });
    if (i === 0) cord(k, scene, s, cables.blue, { x, y: s.y + s.height * 0.4, toX: trayX().net });
  }
}

/** Where a cord runs: out of a port at (x, y) at the back of a device, back to the tray's z, then across to the tray. */
interface Run {
  readonly x: number;
  readonly y: number;
  readonly toX: number;
}

/** One cord from a port at the back of a device to the tray beside it. */
function cord(k: Kit, scene: RackScene, s: Slot, mat: Material, run: Run): void {
  const z0 = s.back - 0.014;
  const zt = trayZ(scene);
  k.b.pipe(mat, [run.x, run.y, z0], [run.x, run.y, zt], 0.004, { shadow: false });
  k.b.pipe(mat, [run.x, run.y, zt], [run.toX, run.y, zt], 0.004, { shadow: false });
}
