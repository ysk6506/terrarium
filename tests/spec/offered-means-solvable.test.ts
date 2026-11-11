/**
 * [REQ-110] An offered scenario is one whose answer key can be reached (ADR-0172). A built-in template that a world offers
 * (`unavailable()` gives no reason) is played by the reference solution (정답 풀이) on that world and must finish without an
 * error and with exactly 100: every part of the score full. A pair that fails is mended where its cause is, in the path or
 * in how the template picks its target, or the template says why the world cannot host it; the score sheet is never
 * lowered. The matrix is the golden one (docs/design-docs/golden-safety-net.md), so the pairs that people are offered on
 * the shapes the product builds by default are the ones held to it.
 */
import { ALL_SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { GOLDEN_WORLDS, goldenWorld } from "./test-support/golden-matrix";
import { casesOf } from "./test-support/golden-scenario";
import { solve } from "./test-support/reference-solver";

/** What a reference run left short of full, or what stopped it. */
function shortOf(world: string): string[] {
  const out: string[] = [];
  for (const c of casesOf(goldenWorld(world))) {
    try {
      const { result } = solve(c.blueprint, c.doc());
      const items = result.score.items
        .filter((i) => i.points < i.max)
        .map((i) => `${i.id} ${i.points}/${i.max}`);
      if (result.score.total !== 100 || items.length > 0)
        out.push(`${c.key}: ${result.score.total} (${items.join(", ")})`);
    } catch (error) {
      out.push(`${c.key}: threw ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

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
      expect(shortOf(world.id)).toEqual([]);
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
