/**
 * Puts an operation on a session (REQ-090): builds the driver from the world and the seed, and writes the report a
 * finished run carries. Kept out of `session.ts` so the session only calls three things: `begin`, `tick`, `step`.
 */
import { serviceHarms } from "@terrarium/core/oracle";
import type { FaultType, RunEvent, World } from "@terrarium/core/world";
import type { OperationReport } from "../types";
import type { OperationConfig } from "./config";
import { OperationDriver } from "./driver";
import { type Candidate, planFaults } from "./generator";
import { operationMetrics } from "./metrics";

/** The equipment the generator may break, read from the world. */
export function candidatesOf(world: World): Candidate[] {
  return world.index.all().map((e) => ({
    id: e.id,
    kind: e.kind,
    ...(e.parentId ? { parentId: e.parentId } : {}),
  }));
}

export interface AttachOptions {
  readonly world: World;
  readonly seed: number;
  /** The run's events so far (team events are counted from here). */
  readonly events: () => readonly RunEvent[];
  readonly skip?: (type: FaultType) => boolean;
}

export function attachOperation(config: OperationConfig, o: AttachOptions): OperationDriver {
  const { world } = o;
  let worldCursor = world.lastSeq();
  let teamSeen = 0;
  const plan = planFaults(candidatesOf(world), config, o.seed);
  return new OperationDriver(config, plan, {
    now: () => world.time(),
    apply: (command, cause) => void world.apply(command, cause),
    faults: () => world.faults(),
    ...(o.skip ? { skip: o.skip } : {}),
    fresh: () => {
      const raised = world.events(worldCursor).filter((e) => e.type === "alarm.raise").length;
      worldCursor = world.lastSeq();
      const team = o.events().filter((e) => e.kind === "counterpart").length;
      const fresh = team - teamSeen;
      teamSeen = team;
      return { alarms: raised, teamEvents: fresh };
    },
  });
}

/** What the result of an operation run says, from its events. */
export function operationReport(
  driver: OperationDriver,
  world: World,
  events: readonly RunEvent[],
  endedAt: number,
): OperationReport {
  const harms = serviceHarms(world.index);
  return {
    config: driver.config,
    metrics: operationMetrics({ events, harms, endedAt }),
    harms,
    planned: driver.faults.length,
    left: driver.left.length,
  };
}
