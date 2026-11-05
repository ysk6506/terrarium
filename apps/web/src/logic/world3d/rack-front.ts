/**
 * What a rack looks like inside, as plain data (REQ-006, REQ-045, REQ-049, feedback 6): the ruler down the
 * rails, what each kind of device shows on its front and on its back, the blank panels over empty units, the
 * top-of-rack slot, and which devices have lights that blink. The drawing code in `ui/world3d/rack-*.ts`
 * only turns these into boxes; the numbers that decide how it looks are checked here without a browser (and
 * what a full rack costs to draw, in `rack-layer.test.ts`).
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import type { Device, RackScene } from "./rack";

/** What a device is, as far as its face goes. */
export type FrontClass = "server" | "server2u" | "gpu" | "storage" | "switch" | "shelf";

export interface FrontSpec {
  readonly cls: FrontClass;
  /** The colour of the bezel plate, "#rrggbb". */
  readonly bezel: string;
  /** Drive bays across and down on the front (0 for none). */
  readonly bays: { readonly cols: number; readonly rows: number };
  /** Rows of slots in a grille (GPU servers breathe through the whole front). */
  readonly grille: number;
  /** Ports on the front of a switch, in rows of at most 24. */
  readonly ports: number;
}

/** What a device shows on its back. */
export interface RearSpec {
  readonly psus: number;
  readonly fans: number;
  readonly nics: number;
}

const BEZEL: Readonly<Record<FrontClass, string>> = {
  server: "#6b7886",
  server2u: "#7d8a98",
  gpu: "#2f6a73",
  storage: "#8c7a5c",
  switch: "#d3d9de",
  shelf: "#8a9096",
};

/** The class of a device's face: its kind and how tall it is decide, not the maker. */
export function classOf(dev: Pick<Device, "kind" | "units" | "look" | "about">): FrontClass {
  if (dev.kind === "switch") return "switch";
  if (dev.kind === "storage") return "storage";
  if (dev.kind === "pdu") return "shelf";
  if (dev.look.front === "gpu-grille" || dev.units >= 4 || dev.about.startsWith("GPU"))
    return "gpu";
  return dev.units >= 2 ? "server2u" : "server";
}

export function frontOf(dev: Pick<Device, "kind" | "units" | "look" | "about">): FrontSpec {
  const cls = classOf(dev);
  const units = Math.max(1, dev.units);
  const bays =
    cls === "server"
      ? { cols: 8, rows: 1 }
      : cls === "server2u"
        ? { cols: 12, rows: 2 }
        : cls === "storage"
          ? { cols: 12, rows: Math.min(4, units) }
          : { cols: 0, rows: 0 };
  return {
    cls,
    bezel: BEZEL[cls],
    bays,
    grille: cls === "gpu" ? Math.min(10, 3 + units * 2) : 0,
    ports: cls === "switch" ? 24 * Math.min(2, units) : 0,
  };
}

/** Power supplies, fans and network ports at the back of a device. */
export function rearOf(dev: Pick<Device, "kind" | "units" | "look" | "about">): RearSpec {
  const cls = classOf(dev);
  if (cls === "gpu") return { psus: 4, fans: 0, nics: 6 };
  if (cls === "switch") return { psus: 2, fans: 3, nics: 0 };
  if (cls === "storage") return { psus: 2, fans: 2, nics: 4 };
  if (cls === "shelf") return { psus: 6, fans: 0, nics: 0 };
  return { psus: 2, fans: cls === "server2u" ? 0 : 0, nics: 3 };
}

// --- the ruler --------------------------------------------------------------------------------

export interface Tick {
  readonly u: number;
  /** Every fifth unit is drawn bold (and numbered in the heavier face). */
  readonly bold: boolean;
}

/** The units of a rack, from 1 up, each with whether it is a fifth-unit mark. */
export function rulerTicks(units: number): Tick[] {
  return Array.from({ length: Math.max(0, units) }, (_, i) => ({
    u: i + 1,
    bold: (i + 1) % 5 === 0 || i === 0,
  }));
}

// --- empty units -------------------------------------------------------------------------------

/** A run of empty units, from `u` (the lowest) up `units` high. */
export interface Gap {
  readonly u: number;
  readonly units: number;
  /** The top unit of the rack, left for the top-of-rack switch. */
  readonly tor: boolean;
}

/** The empty stretches of a rack, lowest first; the topmost unit is marked as the top-of-rack slot when it is empty. */
export function gapsOf(scene: Pick<RackScene, "devices" | "kind">): Gap[] {
  const taken = new Array<boolean>(scene.kind.units + 2).fill(false);
  for (const d of scene.devices)
    for (let u = d.u; u < d.u + Math.max(0, d.units); u++) taken[u] = true;
  const out: Gap[] = [];
  let start = 0;
  for (let u = 1; u <= scene.kind.units + 1; u++) {
    const empty = u <= scene.kind.units && !taken[u];
    if (empty && start === 0) start = u;
    if (!empty && start > 0) {
      out.push({ u: start, units: u - start, tor: u - 1 === scene.kind.units });
      start = 0;
    }
  }
  return out;
}

/** Whether a switch already stands in the top two units (then the rack has its top-of-rack switch). */
export const hasTor = (scene: Pick<RackScene, "devices" | "kind">): boolean =>
  scene.devices.some((d) => d.kind === "switch" && d.u + d.units > scene.kind.units - 2);

// --- lights ------------------------------------------------------------------------------------

/** The power light of a device: green when it is fed, amber when something is wrong with it. */
export type PowerLight = "ok" | "warn" | "off";

export interface Condition {
  readonly warned?: ReadonlySet<string>;
  readonly alarmed?: ReadonlySet<string>;
  readonly unpowered?: ReadonlySet<string>;
}

export function powerLight(id: string, cond: Condition): PowerLight {
  if (cond.unpowered?.has(id)) return "off";
  if (cond.alarmed?.has(id) || cond.warned?.has(id)) return "warn";
  return "ok";
}

/** How long a network light stays on or off, seconds. */
export const BLINK_S = 0.4;

/** Which of two phases a device's network light blinks in, so the busy ones are not all lit at once. */
export function blinkPhase(id: string): 0 | 1 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 2) as 0 | 1;
}

/**
 * Whether the lights of a phase are lit at a time. A struggling machine (strain above 0) or a person who asked
 * for less motion sees them lit and steady, so nothing blinks that the machine has to draw again each time.
 */
export function phaseLit(phase: 0 | 1, seconds: number, steady: boolean): boolean {
  return steady || (Math.floor(seconds / BLINK_S) + phase) % 2 === 0;
}

// --- activity ----------------------------------------------------------------------------------

/** The most draw calls a rack with every unit full may take, shadows included (feedback 6). Checked by the drawing code's own test. */
export const RACK_DRAW_BUDGET = 60;

/**
 * The devices of a rack that have something going on, so their network light blinks: servers with a virtual
 * machine on them or a load of their own, and the switch and the storage when any server of the rack is busy.
 * A light rack's machines are counted, not entities, and all take part.
 */
export function busyDevices(index: BlueprintIndex, scene: Pick<RackScene, "devices">): Set<string> {
  const busy = new Set<string>();
  for (const d of scene.devices) {
    if (d.kind !== "server") continue;
    const load = d.synthetic ? 1 : Number(index.find(d.id)?.props.cpuUtil ?? 0);
    if (d.synthetic || load > 0.05 || index.incoming(d.id, "runs_on").length > 0) busy.add(d.id);
  }
  if (busy.size > 0)
    for (const d of scene.devices) if (d.kind === "switch" || d.kind === "storage") busy.add(d.id);
  return busy;
}
