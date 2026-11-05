/**
 * What lies over the picture (REQ-006, REQ-036): the layer being looked at (plain, power, cooling,
 * network, heat, agents) and live facts about the world (temperatures, alarms, power). The 3D view
 * asks this module for the colour of each rack and nothing else about the layers.
 */
import { heatColor, hex, mix, type Rgb, THEME } from "./palette";
import type { RackSet } from "./racks";

export type Layer = "plain" | "power" | "cooling" | "network" | "heat" | "agents";

export const LAYERS: ReadonlyArray<{ readonly id: Layer; readonly label: string }> = [
  { id: "plain", label: "3D 보기" },
  { id: "power", label: "전력" },
  { id: "cooling", label: "냉각" },
  { id: "network", label: "네트워크" },
  { id: "heat", label: "온도" },
  { id: "agents", label: "에이전트" },
];

export interface Overlay {
  /** Inlet temperature per rack, °C. */
  readonly heat?: ReadonlyMap<string, number>;
  /** Entities with a critical alarm. */
  readonly alarmed?: ReadonlySet<string>;
  /** Entities with a warning. */
  readonly warned?: ReadonlySet<string>;
  /** Racks that have lost power. */
  readonly unpowered?: ReadonlySet<string>;
  /** Share of its rating each rack draws, 0..1. */
  readonly loadShare?: ReadonlyMap<string, number>;
}

const CRITICAL = hex(THEME.critical);
const WARNING = hex(THEME.warning);
const DARK = hex("#6d6a63");
const POWER = hex(THEME.accent.power);
const COOLING = hex(THEME.accent.cooling);
const NETWORK = hex(THEME.accent.network);
const CREAM = hex("#efe7d6");

/** The colour of one rack: its maker's paint, or what the layer says about it. */
export function rackColor(
  layer: Layer,
  overlay: Overlay,
  id: string,
  paint: Rgb,
  fill: number,
): Rgb {
  if (overlay.alarmed?.has(id)) return CRITICAL;
  if (overlay.unpowered?.has(id)) return DARK;
  if (overlay.warned?.has(id) && layer !== "heat") return WARNING;
  switch (layer) {
    case "heat": {
      const c = overlay.heat?.get(id);
      return c === undefined ? CREAM : heatColor(c);
    }
    case "power":
      return mix(CREAM, POWER, overlay.loadShare?.get(id) ?? 0.15 + 0.55 * fill);
    case "cooling":
      return mix(CREAM, COOLING, 0.25 + 0.45 * fill);
    case "network":
      return mix(CREAM, NETWORK, 0.25 + 0.45 * fill);
    case "agents":
      return mix(paint, CREAM, 0.55);
    default:
      return paint;
  }
}

/** Per-instance colours (r, g, b) for one group of racks. */
export function rackColors(layer: Layer, overlay: Overlay, set: RackSet): Float32Array {
  const paint = hex(set.kind.look.body);
  const out = new Float32Array(set.ids.length * 3);
  set.ids.forEach((id, i) => {
    const c = rackColor(layer, overlay, id, paint, set.fill[i] as number);
    out.set(c, i * 3);
  });
  return out;
}
