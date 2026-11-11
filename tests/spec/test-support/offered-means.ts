/**
 * The world shapes the product builds, and the one check that every template a shape offers is solved by the reference
 * solution with exactly 100 (ADR-0172, ADR-0178). The golden matrix is five hand-made worlds; these are the generators a
 * person reaches from the world builder: the default shaped world, every chip of every ladder layer on the default
 * layers, every site preset of the world generator and of the campus generator. Fixed seeds only.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  DEFAULT_CAMPUS,
  DEFAULT_SHAPE,
  DEFAULT_WORLDGEN,
  defaultSize,
  generateCampus,
  generateShaped,
  generateWorld,
  type ShapeSpec,
  SITE_PRESETS,
  type SiteId,
  shapeProblem,
  sizeFields,
} from "@terrarium/core/sources/worldgen";
import { LADDER, LAYER_IDS } from "@terrarium/core/world";
import type { GoldenWorld } from "./golden-matrix";
import { casesOf } from "./golden-scenario";
import { solve } from "./reference-solver";

const catalog = new Catalog();

/** What the reference run of every offered template (all, only the `domain` ones, or all but those: the domain sheets wait four days of run time on a world and take the most time) left short of full, or what stopped it. Empty when all give 100. */
export function shortOf(
  shape: GoldenWorld,
  group: "all" | "domain" | "rest" = "all",
): { offered: number; short: string[] } {
  const cases = casesOf(shape);
  const short: string[] = [];
  for (const c of cases.filter(
    (c) => group === "all" || c.key.startsWith("domain-") === (group === "domain"),
  )) {
    try {
      const { result } = solve(c.blueprint, c.doc());
      const items = result.score.items
        .filter((i) => i.points < i.max)
        .map((i) => `${i.id} ${i.points}/${i.max}`);
      if (result.score.total !== 100 || items.length > 0)
        short.push(`${c.key}: ${result.score.total} (${items.join(", ")})`);
    } catch (error) {
      short.push(`${c.key}: threw ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { offered: cases.length, short };
}

/** The default shaped world, as the world builder opens it. */
export const DEFAULT_WORLD: GoldenWorld = {
  id: "default",
  shape: "generateShaped(DEFAULT_SHAPE)",
  make: () => generateShaped(DEFAULT_SHAPE, catalog).blueprint,
};

const withChip = (layer: string, chip: string): ShapeSpec => ({
  ...DEFAULT_SHAPE,
  ...sizeFields(defaultSize(DEFAULT_SHAPE.services)),
  servers: 12,
  layers: { ...DEFAULT_SHAPE.layers, [layer]: chip },
});

/** Every modelled chip of every ladder layer, set on the default layers (the shapes that can be built). */
export const LADDER_SHAPES: readonly GoldenWorld[] = LAYER_IDS.flatMap((layer) =>
  LADDER[layer]
    .filter((chip) => !shapeProblem(withChip(layer, chip.id)))
    .map(
      (chip): GoldenWorld => ({
        id: `ladder-${chip.id}`,
        shape: `generateShaped(DEFAULT_SHAPE with ${layer}=${chip.id}, servers 12)`,
        make: () => generateShaped(withChip(layer, chip.id), catalog).blueprint,
      }),
    ),
);

/** Every site the world generator and the campus generator have a preset for. */
export const SITES: readonly SiteId[] = SITE_PRESETS.map((p) => p.id);

export const worldShape = (site: SiteId): GoldenWorld => ({
  id: `world-${site}`,
  shape: `generateWorld(DEFAULT_WORLDGEN, site ${site}, seed 1)`,
  make: () => generateWorld({ ...DEFAULT_WORLDGEN, seed: 1, site }, catalog).blueprint,
});

export const campusShape = (site: SiteId): GoldenWorld => ({
  id: `campus-${site}`,
  shape: `generateCampus(DEFAULT_CAMPUS, site ${site}, seed 1)`,
  make: () => generateCampus({ ...DEFAULT_CAMPUS, seed: 1, site }, catalog).blueprint,
});

/** The ladder shapes of one part of `parts`, taken in turn, so the files that split them agree on who has which. */
export const ladderPart = (part: number, parts: number): readonly GoldenWorld[] =>
  LADDER_SHAPES.filter((_, i) => i % parts === part);

/** The fewest templates a shape of that kind still offers: a shape that hides everything would hold the rule vacuously. */
export const OFFERED_AT_LEAST = { default: 20, ladder: 15, world: 17, campus: 20 } as const;
