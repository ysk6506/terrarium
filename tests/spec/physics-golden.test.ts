/**
 * The physics must give the same numbers, bit for bit, however it is written (REQ-005, ADR-0006, ADR-0056).
 * Each world below is warmed up and then put through every fault type that applies to it, one at a time
 * (start it, let it run, end it), plus the commands an agent has. The state after each phase is hashed and
 * compared with the hashes recorded from the engine before it was made faster.
 *
 * Re-record only when the physics is meant to change:  GOLDEN_WRITE=1 npx vitest run tests/spec/physics-golden.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Catalog } from "@terrarium/core/catalog";
import { hashValue } from "@terrarium/core/kernel";
import { Physics } from "@terrarium/core/physics";
import {
  DEFAULT_CAMPUS,
  DEFAULT_WORLDGEN,
  generateCampus,
  generateWorld,
} from "@terrarium/core/sources/worldgen";
import { type Blueprint, FAULT_SPECS, type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { appLab } from "../../packages/core/src/world/test-support/app-lab";
import { k8sLab } from "../../packages/core/src/world/test-support/k8s-lab";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";
import { sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";
import { accelLab, coolingLab, powerLab } from "./test-support/ladder-labs";

const FILE = new URL("./physics-golden.json", import.meta.url);
const catalog = new Catalog();
const WRITE = process.env.GOLDEN_WRITE === "1";

const worlds: ReadonlyArray<readonly [string, () => Blueprint]> = [
  ["sample room", () => sampleBlueprint()],
  [
    "generated hall",
    () =>
      generateWorld({ ...DEFAULT_WORLDGEN, rows: 2, racksPerRow: 4, site: "hwaseong", seed: 3 })
        .blueprint,
  ],
  [
    "campus with plant",
    () =>
      generateCampus({
        ...DEFAULT_CAMPUS,
        site: "cheonan",
        seed: 1,
        buildings: 1,
        fabs: 0,
        podsPerHall: 3,
      }).blueprint,
  ],
  [
    "light racks and liquid halls",
    () =>
      generateCampus({
        ...DEFAULT_CAMPUS,
        site: "pyeongtaek",
        seed: 3,
        buildings: 4,
        hallsPerFloor: 3,
        podsPerHall: 2,
        detail: 0.3,
      }).blueprint,
  ],
  ["sdn overlay", () => sdnLab({ cloudNative: true })],
  // the container layer (REQ-096): a cluster of three control-plane nodes and three workers, and a second cluster
  ["container cluster", () => k8sLab({ second: true })],
  // the application layer (REQ-100): balancer, replicas, sessions, breakers, mesh and two regions
  ["app layer lab", () => appLab({ level: "multiregion" })],
  // the accelerator, power and cooling ladders (REQ-107): GPUs with a fabric and a job, a substation with rack batteries, rear doors and immersion
  ["gpu training lab", () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" })],
  ["power ladder lab", () => powerLab("pwr-substation")],
  ["cooling ladder lab", () => coolingLab("cool-immersion")],
];

const stateHash = (world: World): string =>
  hashValue({ state: world.snapshot().state, seq: world.lastSeq() });

/** The first thing a fault of this type can be put on (a network link for link faults). */
function targetOf(world: World, type: FaultType): string | undefined {
  const spec = FAULT_SPECS.find((s) => s.type === type);
  if (!spec || spec.status !== "supported") return undefined;
  if (spec.targets.includes("link"))
    return world.index.allLinks().find((l) => l.kind === "network")?.id;
  return world.index
    .all()
    .find((e) => (spec.targets as readonly string[]).includes(e.kind) && !e.id.includes("spare"))
    ?.id;
}

function record(name: string, make: () => Blueprint): Record<string, string> {
  const world = World.fromBlueprint(make(), catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  const out: Record<string, string> = { warm: stateHash(world) };
  for (const spec of FAULT_SPECS) {
    const target = targetOf(world, spec.type);
    if (!target) continue;
    const fork = World.fromBlueprint(make(), catalog);
    fork.adopt(world.checkpoint());
    const engine = new Physics(fork);
    fork.apply(
      { type: "fault.add", fault: { id: `f-${spec.type}`, type: spec.type, target, params: {} } },
      "golden",
    );
    engine.run(180);
    out[`${spec.type}: during`] = stateHash(fork);
    fork.apply({ type: "fault.remove", faultId: `f-${spec.type}` }, "golden");
    engine.run(120);
    out[`${spec.type}: after`] = stateHash(fork);
  }
  const fork = World.fromBlueprint(make(), catalog);
  fork.adopt(world.checkpoint());
  const engine = new Physics(fork);
  const server = fork.index.ofKind("server")[0]?.id;
  const cooling = fork.index.ofKind("cooling_unit")[0]?.id;
  if (server) {
    fork.apply({ type: "power.set", target: server, on: false }, "golden");
    engine.run(60);
    fork.apply({ type: "load.set", target: server, value: 0.95 }, "golden");
    fork.apply({ type: "power.set", target: server, on: true }, "golden");
    engine.run(120);
    out.commands = stateHash(fork);
  }
  if (cooling) {
    fork.apply({ type: "setpoint.set", target: cooling, celsius: 22 }, "golden");
    engine.run(180);
    out.setpoint = stateHash(fork);
  }
  return { ...out, "(world)": name };
}

describe("the physics gives the recorded numbers, bit for bit [REQ-005] [REQ-001]", () => {
  const recorded: Record<string, Record<string, string>> = WRITE
    ? {}
    : JSON.parse(readFileSync(FILE, "utf8"));

  test.each(worlds)(
    "%s",
    (name, make) => {
      const got = record(name, make);
      if (WRITE) {
        recorded[name] = got;
        writeFileSync(FILE, `${JSON.stringify(recorded, null, 1)}\n`);
        return;
      }
      expect(got).toEqual(recorded[name]);
    },
    120_000,
  );
});
