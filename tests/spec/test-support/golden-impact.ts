/**
 * The failure origins the impact golden puts on each world, and what is recorded of the range each one makes
 * (REQ-078): which equipment ends up in the range, the rooms, racks and servers it reaches, how soon it turns
 * serious, what happens to the services, and what the range started from.
 */
import { Physics } from "@terrarium/core/physics";
import { impactOf } from "@terrarium/core/topology";
import { type Blueprint, FAULT_SPECS, type FaultType, World } from "@terrarium/core/world";
import { catalog, fingerprintOf, type GoldenWorld, settledWorld } from "./golden-matrix";

export interface Origin {
  readonly key: string;
  readonly type: FaultType;
  readonly target: string;
}

/** Seconds the physics runs after a fault goes on, long enough for heat to show as a trend. */
const RUN_S = 120;

function eligible(world: World, spec: (typeof FAULT_SPECS)[number]): string[] {
  if (spec.targets.includes("link"))
    return world.index
      .allLinks()
      .filter((l) => l.kind === "network")
      .map((l) => l.id);
  return world.index
    .all()
    .filter((e) => (spec.targets as readonly string[]).includes(e.kind) && !e.id.includes("spare"))
    .map((e) => e.id);
}

/** An uplink: the first cable that joins two switches. */
function uplinkOf(world: World): string | undefined {
  const isSwitch = (id: string) => world.index.find(id)?.kind === "switch";
  return world.index
    .allLinks()
    .find((l) => l.kind === "network" && isSwitch(l.from) && isSwitch(l.to))?.id;
}

/**
 * Each supported fault type on the first thing it can be put on, and on the last when that is another thing (a leaf
 * and a spine, the first and the last cluster member); the link faults also on an uplink between two switches.
 */
export function originsOf(world: World): Origin[] {
  const out: Origin[] = [];
  for (const spec of FAULT_SPECS) {
    if (spec.status !== "supported") continue;
    const ids = eligible(world, spec);
    const picks = new Set([ids[0], ids.at(-1)]);
    if (spec.targets.includes("link")) picks.add(uplinkOf(world));
    for (const target of picks)
      if (target) out.push({ key: `${spec.type}@${target}`, type: spec.type, target });
  }
  return out;
}

/** What is recorded of the range, as plain sorted data. */
export function rangeOf(world: World) {
  const impact = impactOf(world);
  const sorted = (s: ReadonlySet<string>) => [...s].sort();
  return {
    affected: sorted(impact.affected),
    rooms: sorted(impact.rooms),
    racks: sorted(impact.racks),
    servers: impact.servers,
    severe: impact.severe ?? null,
    services: impact.services,
    faulted: sorted(impact.causes.faulted),
    alarmed: sorted(impact.causes.alarmed),
  };
}

/** "affected/racks/servers fingerprint" of the range one origin makes on a copy of the settled world. */
function impactFingerprint(blueprint: Blueprint, base: World, origin: Origin): string {
  const fork = World.fromBlueprint(blueprint, catalog);
  fork.adopt(base.checkpoint());
  const engine = new Physics(fork);
  fork.apply(
    {
      type: "fault.add",
      fault: { id: `f-${origin.key}`, type: origin.type, target: origin.target, params: {} },
    },
    "golden",
  );
  engine.run(RUN_S);
  const range = rangeOf(fork);
  return `${range.affected.length}/${range.racks.length}/${range.servers} ${fingerprintOf(range)}`;
}

/** Every origin of a world with its fingerprint, and the healthy world's range under the key "(healthy)". */
export function impactFingerprints(golden: GoldenWorld): Record<string, string> {
  const blueprint = golden.make();
  const base = settledWorld(blueprint);
  const out: Record<string, string> = {
    "(healthy)": `${rangeOf(base).affected.length} ${fingerprintOf(rangeOf(base))}`,
  };
  for (const origin of originsOf(base))
    out[origin.key] = impactFingerprint(blueprint, base, origin);
  return out;
}
