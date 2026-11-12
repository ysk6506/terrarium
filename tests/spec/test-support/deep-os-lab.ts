/** A small world with a host to type commands on, for the tests of the deep operating-system fake (ADR-0117). */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { serviceLab } from "../../../packages/core/src/world/test-support/service-lab";

export interface Shelled {
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
  readonly exitCode: number;
  readonly outside: string[];
  readonly gaps: { readonly tool: string; readonly feature: string }[];
}

export function lab(seconds = 600) {
  const world = World.fromBlueprint(serviceLab(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(seconds);
  const box = new Toolbox(TOOL_NAMES);
  const ctx = { world, facades: {} as Facades };
  const run = (host: string, cmd: string): Shelled => {
    const r = box.call("run_command", { host, cmd }, ctx);
    if (r.error) throw new Error(r.error);
    return r.data as Shelled;
  };
  const sh = (cmd: string, host = "srv-a2"): string => run(host, cmd).output;
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}`, type, target, params } },
      "scenario",
    );
  return { world, physics, run, sh, inject };
}
