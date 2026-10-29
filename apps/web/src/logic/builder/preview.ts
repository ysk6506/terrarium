/**
 * "가동해 보기": run the world's physics in the browser for a while, with no scenario, and see where it
 * runs hot (REQ-001, REQ-006). The same core physics the experiments use, so what the builder shows is
 * what an agent will meet.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import {
  type Alarm,
  type Blueprint,
  hasErrors,
  validateBlueprint,
  World,
} from "@terrarium/core/world";

export interface Preview {
  /** Rack inlet temperature (°C) after the run. */
  readonly heat: ReadonlyMap<string, number>;
  /** Room air temperature (°C). */
  readonly rooms: ReadonlyMap<string, number>;
  readonly alarms: readonly Alarm[];
  /** Entities with a critical alarm, to paint red. */
  readonly alarmed: ReadonlySet<string>;
  readonly hottest?: { readonly id: string; readonly name: string; readonly inletC: number };
  readonly seconds: number;
}

/** Ten simulated minutes: long enough for rooms to settle, short enough to feel instant. */
export const PREVIEW_SECONDS = 600;

export function preview(
  bp: Blueprint,
  catalog: Catalog,
  seconds = PREVIEW_SECONDS,
): Preview | { readonly problems: readonly string[] } {
  const issues = validateBlueprint(bp, catalog);
  if (hasErrors(issues))
    return {
      problems: issues.filter((i) => i.severity === "error").map((i) => `${i.message} (${i.fix})`),
    };
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(seconds);
  const heat = new Map<string, number>();
  for (const rack of world.index.ofKind("rack"))
    heat.set(rack.id, world.stateAs(rack.id, "rack").inletC);
  const rooms = new Map<string, number>();
  for (const room of world.index.ofKind("room"))
    rooms.set(room.id, world.stateAs(room.id, "room").ambientC);
  const alarms = world.alarms();
  let hottest: Preview["hottest"];
  for (const [id, inletC] of heat)
    if (!hottest || inletC > hottest.inletC)
      hottest = { id, name: world.index.entity(id).name, inletC };
  return {
    heat,
    rooms,
    alarms,
    alarmed: new Set(alarms.filter((a) => a.severity === "critical").map((a) => a.entityId)),
    ...(hottest ? { hottest } : {}),
    seconds,
  };
}
