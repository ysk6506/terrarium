/**
 * The status line under a tile's name: how that piece of equipment is doing, with one number in it. Plain
 * words and Arabic numerals with their units (the glossary's rules); a word, not a sentence.
 */
import type { EntityState } from "@terrarium/core/world";
import type { LayerId } from "./types";

const deg = (v: number): string => `${v.toFixed(1)}°C`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const power = (w: number): string =>
  w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;

const PHASES = {
  standby: "대기 중이에요",
  starting: "시동을 거는 중이에요",
  running: "돌아가요",
  failed: "시동이 안 걸려요",
} as const;

type Reader = (s: EntityState, layer: LayerId) => string | undefined;

/** One reader per kind of state; a reader that knows nothing about a state says nothing. */
const READERS: Readonly<Record<string, Reader>> = {
  chiller: (s) =>
    s.kind === "chiller" ? (s.running ? `공급 ${deg(s.supplyC)}` : "멈췄어요") : undefined,
  cooling_unit: (s) =>
    s.kind === "cooling_unit"
      ? s.running
        ? `${pct(s.loadKw / Math.max(1, s.capacityKw))} 돌아가요`
        : "멈췄어요"
      : undefined,
  cdu: (s) =>
    s.kind === "cdu"
      ? s.running
        ? `${pct(s.loadKw / Math.max(1, s.capacityKw))} 돌아가요`
        : "멈췄어요"
      : undefined,
  room: (s) => (s.kind === "room" ? `공기 ${deg(s.ambientC)}` : undefined),
  rack: (s, layer) => {
    if (s.kind !== "rack") return undefined;
    if (layer === "power") return s.powered ? power(s.powerW) : "전기가 끊겼어요";
    return `흡기 ${deg(s.inletC)}`;
  },
  server: (s, layer) => {
    if (s.kind !== "server") return undefined;
    if (!s.powered) return "꺼졌어요";
    if (layer === "power") return power(s.powerW);
    if (layer === "network") return `CPU ${pct(s.cpuUtil)}`;
    return `흡기 ${deg(s.inletC)}`;
  },
  storage: (s) => {
    if (s.kind !== "storage") return undefined;
    if (!s.powered) return "꺼졌어요";
    return s.failedDisks > 0
      ? `디스크 ${s.failedDisks}개 고장`
      : `${Math.round(s.usedPct)}% 찼어요`;
  },
  ups: (s) => {
    if (s.kind !== "ups") return undefined;
    return s.onBattery ? `배터리 ${Math.round(s.batteryPct)}%` : `부하 ${power(s.loadW)}`;
  },
  power_panel: (s) => {
    if (s.kind !== "power_panel") return undefined;
    if (s.tripped) return "차단기가 떨어졌어요";
    return s.powered ? `부하 ${power(s.loadW)}` : "전기가 없어요";
  },
  pdu: (s) => {
    if (s.kind !== "pdu") return undefined;
    if (s.tripped) return "차단기가 떨어졌어요";
    return s.powered ? `부하 ${power(s.loadW)}` : "전기가 없어요";
  },
  generator: (s) => (s.kind === "generator" ? PHASES[s.phase] : undefined),
  switch: (s) =>
    s.kind === "switch" ? (s.powered && s.adminOn ? "켜져 있어요" : "꺼졌어요") : undefined,
  service: (s) => {
    if (s.kind !== "service") return undefined;
    if (s.status === "down") return "멈췄어요";
    return s.status === "degraded" ? "느려졌어요" : "잘 돌아가요";
  },
  vm: (s) => (s.kind === "vm" ? (s.running ? `CPU ${pct(s.cpuUsage)}` : "꺼졌어요") : undefined),
};

/** What to say under a piece of equipment, given its state. */
export function lineOf(state: EntityState, layer: LayerId): string {
  return READERS[state.kind]?.(state, layer) ?? "";
}
