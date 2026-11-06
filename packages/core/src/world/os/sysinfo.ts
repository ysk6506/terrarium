/**
 * The numbers of a host that more than one command prints (ADR-0117): memory, load and disk. `free`, `top`,
 * `/proc/meminfo`, `/proc/loadavg`, `df` and `uptime` all read them from here so they never disagree.
 */
import type { OsHost } from "./host";
import { ROOT_BYTES } from "./layout";

export interface MemInfo {
  readonly totalMb: number;
  readonly usedMb: number;
  readonly freeMb: number;
  readonly cacheMb: number;
  readonly availMb: number;
  readonly sharedMb: number;
  readonly swapMb: number;
}

export function memInfo(h: OsHost): MemInfo {
  const total = h.memTotalMb;
  const used = Math.round((h.os.memPct / 100) * total);
  const cache = Math.round(total * 0.12);
  const free = Math.max(0, total - used - cache);
  return {
    totalMb: total,
    usedMb: used,
    freeMb: free,
    cacheMb: cache,
    availMb: Math.min(total, free + Math.round(cache * 0.85)),
    sharedMb: 1203,
    swapMb: 8191,
  };
}

/** The 1, 5 and 15 minute load averages. */
export function loadAvg(h: OsHost): [number, number, number] {
  const l = (h.os.cpuPct / 100) * h.cores;
  return [l, l * 0.95, l * 0.9];
}

export interface DiskInfo {
  readonly usedBytes: number;
  readonly totalBytes: number;
  readonly pct: number;
}

export function diskInfo(h: OsHost): DiskInfo {
  return {
    usedBytes: Math.round((h.os.diskPct / 100) * ROOT_BYTES),
    totalBytes: ROOT_BYTES,
    pct: h.os.diskPct,
  };
}
