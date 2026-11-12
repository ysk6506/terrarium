/**
 * [REQ-110] The rule that an offered scenario is solved with 100 (ADR-0172) is held on every shape the product builds by
 * the `offered-means-*.test.ts` files (ADR-0178). This file keeps those files honest: between them they take every ladder
 * chip shape once and every site preset, and the shapes that cannot host a scenario say why in plain words.
 */
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { LADDER_SHAPES, ladderPart, SITES } from "./test-support/offered-means";

describe("the generated shapes are all held to the same rule, file by file [REQ-110] [REQ-111]", () => {
  test("the three ladder files between them take every chip shape once", () => {
    const ids = [...ladderPart(0, 3), ...ladderPart(1, 3), ...ladderPart(2, 3)]
      .map((w) => w.id)
      .sort();
    expect(ids).toEqual(LADDER_SHAPES.map((w) => w.id).sort());
    expect(LADDER_SHAPES.length).toBeGreaterThan(40);
  });

  test("a file stands for each site preset, for the world generator and for the campus generator", () => {
    expect(SITES).toEqual(["giheung", "hwaseong", "onyang", "cheonan", "suwon", "pyeongtaek"]);
  });
});

describe("a generated shape that cannot reach the answer key says why, in plain words [REQ-110] [REQ-111]", () => {
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
    expect(reasonOn("ladder-app-multiregion", "sidecar-crash")).toMatch(
      /리전이 로테이션에서 빠졌다/,
    );
  });

  test("a cold DR site has no standby that is switched on", () => {
    expect(reasonOn("ladder-site-dr-cold", "os-memory-leak")).toMatch(/켜져 있는 대기 쪽/);
    expect(reasonOn("ladder-site-dr-cold", "os-process-crashloop")).toMatch(/켜져 있는 대기 쪽/);
  });
});
