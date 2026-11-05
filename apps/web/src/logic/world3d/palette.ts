/**
 * The look the user chose (ADR-0037, design C: a warm cream, tilt-shift miniature diorama), as values.
 * The 3D view reads colours from here and nowhere else.
 */
export type Rgb = readonly [number, number, number];

export const hex = (h: string): Rgb => {
  const n = Number.parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};

/** Approved values of design C. */
export const THEME = {
  sky: ["#f6efe2", "#f3e6d0", "#efe0c8"],
  /** How much the corners of boxes are rounded, metres at the scale of a rack. */
  rounded: 0.35,
  tilt: 1,
  sun: { color: "#fff3df", intensity: 2.6 },
  hemisphere: { sky: "#fff5e6", ground: "#c9b79c", intensity: 0.9 },
  accent: { power: "#f2a516", cooling: "#2a9dd8", network: "#6a7df0", heat: "#e8603c" },
  agents: ["#e5446d", "#6a4be6", "#1aa37a"],
  ground: {
    grass: "#a7d17a",
    lawn: "#b9dc8c",
    asphalt: "#6b7280",
    concrete: "#e4dccb",
    slab: "#e9dfcf",
  },
  building: { wall: "#f6f1e7", trim: "#c9c0ae", glass: "#8cc6e6", roof: "#b9bfc2" },
  rack: { body: "#4a5060", frame: "#1b1e22" },
  critical: "#d8322a",
  warning: "#e0a21a",
  ok: "#37c47a",
} as const;

/** Temperature (°C of rack inlet air) to colour: cool blue, comfortable cream, warm amber, hot red. */
export const HEAT_STOPS: ReadonlyArray<readonly [number, Rgb]> = [
  [18, hex("#2a9dd8")],
  [24, hex("#e2e6cf")],
  [28, hex("#f2b24a")],
  [32, hex("#e8603c")],
];

export function heatColor(c: number): Rgb {
  const first = HEAT_STOPS[0] as (typeof HEAT_STOPS)[number];
  if (c <= first[0]) return first[1];
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i] as (typeof HEAT_STOPS)[number];
    const [t0, c0] = HEAT_STOPS[i - 1] as (typeof HEAT_STOPS)[number];
    if (c <= t1) return mix(c0, c1, (c - t0) / (t1 - t0));
  }
  return (HEAT_STOPS.at(-1) as (typeof HEAT_STOPS)[number])[1];
}

/** Room purposes and cooling modes get a colour on plans and section floors. */
export const PURPOSE_COLORS: Readonly<Record<string, string>> = {
  data_hall: "#2a9dd8",
  electrical: "#f2a516",
  battery: "#e0861c",
  mechanical: "#19b6c9",
  network: "#6a7df0",
  noc: "#9a8f7c",
  cleanroom: "#7fb3c8",
};

export const MODE_COLORS: Readonly<Record<string, string>> = {
  air: "#4f7cc4",
  hybrid: "#4f7cc4",
  dlc: "#0fa5b5",
  immersion: "#7a4be0",
};

/**
 * The colours of the runs working in a world, one for each of `WORKER_HUES`. Cool and violet, away from the
 * warm end of the heat scale so a run is never mistaken for a hot spot; the same values stand in styles.css as --run-N.
 */
export const WORKER_COLORS: readonly string[] = [
  "#2f6dc0",
  "#7a4fc4",
  "#d1457a",
  "#17a398",
  "#4b5fd1",
  "#6b9a2f",
  "#8a5a9c",
  "#3a8aa8",
];
