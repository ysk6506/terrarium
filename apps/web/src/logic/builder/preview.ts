/**
 * "돌려 보기": run the world's physics in the browser for a while, with no scenario, and see where it
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

/** What the physics read at one moment of the run: what the airflow map is drawn from (REQ-072). */
export interface PreviewFrame {
  /** Simulated seconds since the start. */
  readonly t: number;
  readonly racks: ReadonlyMap<string, { readonly inletC: number; readonly outletC: number }>;
  readonly units: ReadonlyMap<
    string,
    {
      readonly running: boolean;
      readonly supplyC: number;
      readonly returnC: number;
      readonly loadKw: number;
      readonly capacityKw: number;
    }
  >;
  /** Room air temperature (°C). */
  readonly rooms: ReadonlyMap<string, number>;
  /** The alarms active at that moment: the people in the room go to them (REQ-074). */
  readonly alarms: ReadonlyArray<Pick<Alarm, "entityId" | "severity" | "since">>;
}

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
  /** The run at intervals, the first before anything moved: the airflow map's time scrubber follows it. */
  readonly frames: readonly PreviewFrame[];
  /** Cooling units that were stopped for the run ("멈춰 보기"). */
  readonly stopped: ReadonlySet<string>;
  /** The world as the run left it: the topology view reads its faults, alarms and states from here. */
  readonly world: World;
}

/** Ten simulated minutes: long enough for rooms to settle, short enough to feel instant. */
export const PREVIEW_SECONDS = 600;

/** Seconds between two frames, and for a very big world (thousands of racks) between two. */
const FRAME_S = 30;
const FRAME_BIG_S = 100;
const BIG_WORLD_RACKS = 2000;
const NO_UNITS: ReadonlySet<string> = new Set();

function frameOf(world: World, t: number): PreviewFrame {
  const racks = new Map<string, { inletC: number; outletC: number }>();
  for (const rack of world.index.ofKind("rack")) {
    const s = world.stateAs(rack.id, "rack");
    racks.set(rack.id, { inletC: s.inletC, outletC: s.outletC });
  }
  const units = new Map<
    string,
    { running: boolean; supplyC: number; returnC: number; loadKw: number; capacityKw: number }
  >();
  for (const unit of world.index.ofKind("cooling_unit")) {
    const s = world.stateAs(unit.id, "cooling_unit");
    units.set(unit.id, {
      running: s.running,
      supplyC: s.supplyC,
      returnC: s.returnC,
      loadKw: s.loadKw,
      capacityKw: s.capacityKw,
    });
  }
  const rooms = new Map<string, number>();
  for (const room of world.index.ofKind("room"))
    rooms.set(room.id, world.stateAs(room.id, "room").ambientC);
  const alarms = world
    .alarms()
    .map((a) => ({ entityId: a.entityId, severity: a.severity, since: a.since }));
  return { t, racks, units, rooms, alarms };
}

/** Run the world for `seconds`; the cooling units named in `stopped` fail right after the start. */
export function preview(
  bp: Blueprint,
  catalog: Catalog,
  seconds = PREVIEW_SECONDS,
  stopped: ReadonlySet<string> = NO_UNITS,
): Preview | { readonly problems: readonly string[] } {
  const issues = validateBlueprint(bp, catalog);
  if (hasErrors(issues))
    return {
      problems: issues.filter((i) => i.severity === "error").map((i) => `${i.message} (${i.fix})`),
    };
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  const frames = [frameOf(world, 0)];
  for (const id of stopped)
    if (world.index.find(id)?.kind === "cooling_unit")
      world.apply(
        {
          type: "fault.add",
          fault: { id: `stop-${id}`, type: "cooling_unit_failure", target: id, params: {} },
        },
        "preview",
      );
  const every = world.index.ofKind("rack").length > BIG_WORLD_RACKS ? FRAME_BIG_S : FRAME_S;
  for (let t = 0; t < seconds; t += every) {
    const dt = Math.min(every, seconds - t);
    physics.run(dt);
    frames.push(frameOf(world, t + dt));
  }
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
    frames,
    stopped,
    world,
  };
}
