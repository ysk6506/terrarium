/**
 * [REQ-110] An offered scenario is one whose answer key can be reached (ADR-0172). A built-in template that a world offers
 * (`unavailable()` gives no reason) is played by the reference solution (정답 풀이) on that world and must finish without an
 * error and with exactly 100: every part of the score full. A pair that fails is mended where its cause is, in the path or
 * in how the template picks its target, or the template says why the world cannot host it; the score sheet is never
 * lowered. The matrix is the golden one (docs/design-docs/golden-safety-net.md). The generated shapes (the default world,
 * every ladder chip, every site preset) are held to it in the `offered-means-*.test.ts` files next to this one (ADR-0178).
 */
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { GOLDEN_WORLDS, goldenWorld } from "./test-support/golden-matrix";
import { casesOf } from "./test-support/golden-scenario";
import { LADDER_SHAPES, ladderPart, SITES, shortOf } from "./test-support/offered-means";

/** The fewest templates each matrix world still offers: a world that hides everything would hold the rule vacuously. */
const AT_LEAST: Readonly<Record<string, number>> = {
  iap: 22,
  campus: 45,
  sdn: 22,
  train: 24,
  fabric: 11,
};

describe("an offered scenario is one the reference solution finishes with 100 [REQ-110] [REQ-001]", () => {
  for (const world of GOLDEN_WORLDS) {
    test(`${world.id}: every template the world offers gives 100 and no error`, () => {
      expect(shortOf(world).short).toEqual([]);
    }, 120_000);
  }

  test("the matrix still offers a real set of templates on every world", () => {
    for (const world of GOLDEN_WORLDS)
      expect(casesOf(world).length, world.id).toBeGreaterThanOrEqual(AT_LEAST[world.id] as number);
  });
});

describe("a world that cannot reach the answer key says why it does not offer the scenario [REQ-110] [REQ-001]", () => {
  const reasonOn = (world: string, template: string): string | undefined => {
    const t = ALL_SCENARIO_TEMPLATES.find((x) => x.id === template);
    return t?.unavailable(new BlueprintIndex(goldenWorld(world).make()));
  };

  test("campus has no batch work to scale down and no room for every pod once the node is back", () => {
    expect(reasonOn("campus", "k8s-pending")).toMatch(/줄여도 되는 배치 작업/);
    expect(reasonOn("campus", "k8s-disk-pressure")).toMatch(/파드가 다 들어갈 자리가 없는/);
  });

  test("campus has no server in its recovery site to move the services to", () => {
    expect(reasonOn("campus", "site-power-loss")).toMatch(/복구 사이트에 서버가 하나도 없어서/);
    expect(reasonOn("campus", "dr-failover-stuck")).toMatch(/복구 사이트에 서버가 하나도 없어서/);
  });

  test("a world with the workload, the room and the servers still offers them", () => {
    expect(reasonOn("iap", "k8s-pending")).toBeUndefined();
    expect(reasonOn("iap", "k8s-disk-pressure")).toBeUndefined();
  });
});

describe("the generated shapes are all held to the same rule, file by file [REQ-110] [REQ-111]", () => {
  test("the three ladder files between them take every chip shape once", () => {
    const ids = [...ladderPart(0, 3), ...ladderPart(1, 3), ...ladderPart(2, 3)].map((w) => w.id).sort();
    expect(ids).toEqual(LADDER_SHAPES.map((w) => w.id).sort());
    expect(LADDER_SHAPES.length).toBeGreaterThan(40);
  });

  test("a file stands for each site preset, for the world generator and for the campus generator", () => {
    expect(SITES).toEqual(["giheung", "hwaseong", "onyang", "cheonan", "suwon", "pyeongtaek"]);
  });
});

describe("a generated shape that cannot reach the answer key says why, in plain words [REQ-110] [REQ-001]", () => {
  const reasonOn = (shape: string, template: string): string | undefined => {
    const world = LADDER_SHAPES.find((w) => w.id === shape);
    const t = ALL_SCENARIO_TEMPLATES.find((x) => x.id === template);
    return world ? t?.unavailable(new BlueprintIndex(world.make())) : "no such shape";
  };

  test("too many servers behind the UPS to switch off one call at a time", () => {
    expect(reasonOn("ladder-pwr-2n-gen", "outage-generator-fails")).toMatch(
      /UPS 뒤에 서버가 \d+대나/,
    );
  });

  test("a service across regions comes back only after its regions leave and re-enter the balancer", () => {
    expect(reasonOn("ladder-app-multiregion", "sidecar-crash")).toMatch(/리전이 로테이션에서 빠졌다/);
  });

  test("a cold DR site has no standby that is switched on", () => {
    expect(reasonOn("ladder-site-dr-cold", "os-memory-leak")).toMatch(/켜져 있는 대기 쪽/);
    expect(reasonOn("ladder-site-dr-cold", "os-process-crashloop")).toMatch(/켜져 있는 대기 쪽/);
  });
});
