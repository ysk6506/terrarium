/**
 * What a big campus costs (REQ-049, REQ-032): entities, links, how long it takes to generate, to open
 * and to take one 10-second step, for a few `detail` settings. Not a test (it takes a minute): run it,
 * read the numbers, put them in docs/design-docs/capacity.md.
 *
 *   npx tsx tests/spec/hall-scale.ts
 *   npx tsx tests/spec/hall-scale.ts --buildings 4 --floors 2 --halls 3 --pods 60 --detail 0.03
 *
 * Without arguments it measures a built-out campus and two light-rack campuses.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { World } from "@terrarium/core/world";

const arg = (name: string): number | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : undefined;
};

interface Case {
  readonly buildings: number;
  readonly floors: number;
  readonly halls: number;
  readonly pods: number;
  readonly detail: number;
}

const given: Case | undefined =
  arg("pods") === undefined
    ? undefined
    : {
        buildings: arg("buildings") ?? 2,
        floors: arg("floors") ?? 1,
        halls: arg("halls") ?? 2,
        pods: arg("pods") ?? 6,
        detail: arg("detail") ?? 1,
      };

const CASES: readonly Case[] = given
  ? [given]
  : [
      { buildings: 2, floors: 1, halls: 2, pods: 6, detail: 1 },
      { buildings: 3, floors: 2, halls: 2, pods: 40, detail: 0.05 },
      { buildings: 4, floors: 2, halls: 3, pods: 60, detail: 0.03 },
    ];

const catalog = new Catalog();
const ms = (from: number) => Math.round(performance.now() - from);

for (const c of CASES) {
  const spec = {
    ...DEFAULT_CAMPUS,
    site: "pyeongtaek" as const,
    seed: 3,
    buildings: c.buildings,
    floors: c.floors,
    hallsPerFloor: c.halls,
    podsPerHall: c.pods,
    detail: c.detail,
  };
  let from = performance.now();
  const { blueprint, stats } = generateCampus(spec, catalog);
  const generate = ms(from);
  from = performance.now();
  const world = World.fromBlueprint(blueprint, catalog);
  const open = ms(from);
  const physics = new Physics(world);
  from = performance.now();
  physics.settle();
  const settle = ms(from);
  const steps = 5;
  from = performance.now();
  for (let i = 0; i < steps; i++) physics.step(10);
  const step = Math.round((ms(from) / steps) * 10) / 10;
  process.stdout.write(
    `${JSON.stringify({
      ...c,
      entities: blueprint.entities.length,
      links: blueprint.links.length,
      racks: stats.rack ?? 0,
      servers: stats.server ?? 0,
      generateMs: generate,
      openMs: open,
      settleMs: settle,
      stepMs: step,
      heapMB: Math.round(process.memoryUsage().heapUsed / 1e6),
    })}\n`,
  );
}
