/**
 * A world with a host to type commands on, with the new shell engine plugged in (ADR-0200). The same shape as `lab()`
 * of the old shell, plus the clock of an event run: `sleep` moves the world through the physics, as far as a `wait` may.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import {
  type ShellEngineResult,
  type ShellLimits,
  type ShellPlug,
  World,
} from "@terrarium/core/world";
import { WasmShellEngine } from "../../../apps/server/src/shell";
import { serviceLab } from "../../../packages/core/src/world/test-support/service-lab";
import type { Shelled } from "./deep-os-lab";

/** One engine for a whole test file: the module is compiled once and the workers are kept. */
let shared: WasmShellEngine | undefined;
export const sharedEngine = (): WasmShellEngine => {
  shared ??= new WasmShellEngine();
  return shared;
};

export interface EngineLabOptions {
  readonly seconds?: number;
  /** Smaller limits for the test. */
  readonly limits?: Partial<ShellLimits>;
  /** An operation: the world follows its own clock, so a line cannot let time pass. */
  readonly operation?: boolean;
  /** How many seconds of the run are left (an event's `wait` stops there). */
  readonly remaining?: number;
  readonly engine?: WasmShellEngine;
  readonly seed?: number;
}

export function engineLab(o: EngineLabOptions = {}) {
  const world = World.fromBlueprint(serviceLab(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(o.seconds ?? 600);
  const box = new Toolbox(TOOL_NAMES);
  const started = world.time();
  const results: { line: string; result: ShellEngineResult }[] = [];
  let calls = 0;
  const plug: ShellPlug = {
    engine: o.engine ?? sharedEngine(),
    seed: o.seed ?? 7,
    callNumber: () => calls++,
    clock: {
      budget: () =>
        o.operation
          ? 0
          : Math.max(0, Math.min(3600, (o.remaining ?? 1e9) - (world.time() - started))),
      advance: (s) => physics.run(s),
    },
    ...(o.limits ? { limits: o.limits } : {}),
    observe: (line, result) => results.push({ line, result }),
  };
  const ctx = { world, facades: {} as Facades, shell: plug };
  const run = (host: string, cmd: string): Shelled => {
    const r = box.call("run_command", { host, cmd }, ctx);
    if (r.error) throw new Error(r.error);
    return r.data as Shelled;
  };
  const sh = (cmd: string, host = "srv-a2"): string => run(host, cmd).output;
  return { world, physics, run, sh, results, plug, started, since: () => world.time() - started };
}
