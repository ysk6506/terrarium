/**
 * Power capping at rack level (REQ-107, ADR-0130, docs/design-docs/power-capping-reference.md): given the power a rack may
 * draw, how to split it over its servers. Two ways, the two baselines of the reference: 균등 (everyone gets the same share,
 * what a server does not need goes to the others) and 부하 비례 (the share follows what each server asks for above idle).
 * A cap never goes below a server's idle power, so a limit under the idle sum cannot be kept; `kept` says so.
 */

import { defaultsOf } from "@terrarium/core/physics/slots";

/** The planner's own estimate of the throughput under a cap uses v1's numbers (a plan is made before any run, with no world to ask). */
const V1 = defaultsOf("power.device");

export type CapMode = "equal" | "proportional";

export interface CapServer {
  readonly id: string;
  /** What the server would draw uncapped, W. */
  readonly demandW: number;
  readonly idleW: number;
  readonly maxW: number;
}

export interface CapPlan {
  /** Cap per server, W (never below idle, never above what it asks for). */
  readonly caps: ReadonlyMap<string, number>;
  /** Whether the caps add up to no more than the limit. False when the idle power alone is over it. */
  readonly kept: boolean;
  /** Watts of demand the caps leave unserved. */
  readonly shortfallW: number;
}

/** The throughput left when a server asking `demandW` is held to `capW` (dynamic power ~ f^2.5, so perf ~ share^0.4). */
export function perfUnderCap(capW: number, demandW: number, idleW: number): number {
  const dyn = demandW - idleW;
  if (dyn <= 0 || capW >= demandW) return 1;
  return Math.max(V1.capPerfFloor, Math.max(0, capW - idleW) / dyn) ** V1.capPerfExponent;
}

/** Split `limitW` over the servers. Water-filling: a server that needs less than its share frees the rest for the others. */
export function distributeCap(
  limitW: number,
  servers: readonly CapServer[],
  mode: CapMode,
): CapPlan {
  const need = new Map(servers.map((s) => [s.id, Math.min(s.demandW, s.maxW)]));
  const idle = servers.reduce((n, s) => n + s.idleW, 0);
  const caps = new Map<string, number>(servers.map((s) => [s.id, s.idleW]));
  let spare = Math.max(0, limitW - idle);
  let open = servers.filter((s) => (need.get(s.id) as number) > s.idleW);
  // each round gives every open server its share of the spare, up to what it asks for; the satisfied ones leave
  for (let round = 0; round < servers.length + 1 && spare > 1e-6 && open.length > 0; round++) {
    const weight = (s: CapServer) =>
      mode === "equal" ? 1 : Math.max(1e-9, (need.get(s.id) as number) - s.idleW);
    const total = open.reduce((n, s) => n + weight(s), 0);
    let used = 0;
    for (const s of open) {
      const room = (need.get(s.id) as number) - (caps.get(s.id) as number);
      const give = Math.min(room, (spare * weight(s)) / total);
      caps.set(s.id, (caps.get(s.id) as number) + give);
      used += give;
    }
    spare -= used;
    open = open.filter((s) => (need.get(s.id) as number) - (caps.get(s.id) as number) > 1e-6);
  }
  const sum = [...caps.values()].reduce((n, w) => n + w, 0);
  const shortfall = servers.reduce(
    (n, s) => n + Math.max(0, (need.get(s.id) as number) - (caps.get(s.id) as number)),
    0,
  );
  return { caps, kept: sum <= limitW + 1e-6, shortfallW: shortfall };
}
