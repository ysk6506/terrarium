/**
 * The reference solution (정답 풀이) played on every built-in scenario template a matrix world can host (REQ-110), and
 * what is recorded of each run: the score breakdown and the final world state. A template no matrix world can host is
 * played in the world the reference tests give it (`operatorCases`), so every template is pinned once at least. Seed 1
 * everywhere; the solver and the sessions use the simulated clock only.
 */
import { ALL_SCENARIO_TEMPLATES, type ScenarioDoc } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { fingerprintOf, GOLDEN_WORLDS, type GoldenWorld } from "./golden-matrix";
import { operatorCases } from "./operator-worlds";
import { type Play, play } from "./reference-solver";

export interface GoldenCase {
  readonly key: string;
  readonly blueprint: Blueprint;
  readonly doc: () => ScenarioDoc;
}

/** Every template the world can host, as `template@world`. */
export function casesOf(golden: GoldenWorld): GoldenCase[] {
  const blueprint = golden.make();
  const index = new BlueprintIndex(blueprint);
  return ALL_SCENARIO_TEMPLATES.filter((t) => !t.unavailable(index)).map((t) => ({
    key: `${t.id}@${golden.id}`,
    blueprint,
    doc: () => t.build(index, "lab"),
  }));
}

/** The templates no matrix world can host, each in the world the reference tests play it in. */
export function extraCases(): GoldenCase[] {
  const covered = new Set(
    GOLDEN_WORLDS.flatMap((w) => casesOf(w).map((c) => c.key.split("@")[0] as string)),
  );
  return operatorCases()
    .filter((c) => !covered.has(c.id))
    .map((c) => ({
      key: `${c.id}@extra`,
      blueprint: c.blueprint,
      doc: () => c.template.build(new BlueprintIndex(c.blueprint), "lab"),
    }));
}

/** Play the reference solution; the score and the final world state as fingerprints, or what stopped the solver. */
export function recordCase(c: GoldenCase, seed = 1): { score: string; world: string } {
  const doc = c.doc();
  const session = Session.create({
    blueprint: c.blueprint,
    scenario: doc,
    tools: TOOL_NAMES,
    seed,
  });
  session.start();
  const index = new BlueprintIndex(c.blueprint);
  const run: Play = {
    config: "",
    index,
    alarms: [],
    last: {},
    servers: index.ofKind("server").map((e) => e.id),
    call: (tool, args = {}) => session.call(tool, args),
  };
  try {
    play(run, doc);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { score: `threw ${fingerprintOf(message)}`, world: "-" };
  }
  const result = session.finish();
  const world = session.world;
  return {
    score: `${result.score.total} ${fingerprintOf(result.score)}`,
    world: fingerprintOf({ state: world.snapshot().state, seq: world.lastSeq() }),
  };
}

/** Every case of a list with its `score` and `world` fingerprints, keyed `template@world:score` and `:world`. */
export function recordCases(cases: readonly GoldenCase[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of cases) {
    const got = recordCase(c);
    out[`${c.key}:score`] = got.score;
    out[`${c.key}:world`] = got.world;
  }
  return out;
}
