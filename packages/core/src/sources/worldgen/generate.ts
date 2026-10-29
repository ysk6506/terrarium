/**
 * worldgen (REQ-009, REQ-035): a deterministic world from a site preset and size parameters.
 * Same spec and seed, same world. Layout and geometry come from the shared assembler (ADR-0008).
 */
import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError, SeededRng } from "@terrarium/core/kernel";
import { type AssemblyResult, BlueprintAssembler } from "@terrarium/core/sources";
import type { EntityKind } from "@terrarium/core/world";
import { buildRoom } from "./room";
import { type SitePreset, sitePreset, specProblems, type WorldgenSpec } from "./spec";

export interface WorldgenResult extends AssemblyResult {
  readonly stats: Readonly<Partial<Record<EntityKind, number>>>;
}

const ROOM_LETTERS = "ABCD";
const UPS_MODEL = "ups-500kva";

export function generateWorld(
  spec: WorldgenSpec,
  catalog: Catalog = new Catalog(),
): WorldgenResult {
  const problems = specProblems(spec);
  if (problems.length > 0)
    throw new InvalidValueError(`세계를 만들 수 없다: ${problems.join("; ")}`);
  const preset = sitePreset(spec.site) as SitePreset;
  const rng = new SeededRng(spec.seed);
  const id = `${preset.code}-${spec.seed}`;
  const asm = new BlueprintAssembler(id, spec.name ?? `${preset.name} 데이터센터`, catalog, {
    source: "worldgen",
    site: preset.id,
    seed: spec.seed,
  });
  asm.site(preset.code, preset.name, preset.land, { preset: preset.id });
  const vcenter = `${preset.code}-vc`;
  if (spec.vmsPerHost > 0) asm.virtual(vcenter, "vcenter", `vcsa-${preset.code}`);
  for (let b = 1; b <= spec.buildings; b++) {
    const buildingId = `${preset.code}-dc${b}`;
    asm.building(buildingId, preset.code, `DC${b}동`);
    for (let f = 1; f <= spec.floors; f++)
      addFloor({ asm, catalog, rng, spec, preset, vcenter }, buildingId, b, f);
  }
  const result = asm.build();
  const stats: Partial<Record<EntityKind, number>> = {};
  for (const e of result.blueprint.entities) stats[e.kind] = (stats[e.kind] ?? 0) + 1;
  return { ...result, stats };
}

/** What every floor of one generated site shares. */
interface SiteContext {
  readonly asm: BlueprintAssembler;
  readonly catalog: Catalog;
  readonly rng: SeededRng;
  readonly spec: WorldgenSpec;
  readonly preset: SitePreset;
  readonly vcenter: string;
}

function addFloor(site: SiteContext, buildingId: string, b: number, f: number): void {
  const { asm, catalog, rng, spec, preset, vcenter } = site;
  const floorId = `${buildingId}-f${f}`;
  asm.floor(floorId, buildingId, `${f}F`, f);
  const ups = {
    a: `${floorId}-ups-a`,
    b: spec.powerRedundancy === "2N" ? `${floorId}-ups-b` : `${floorId}-ups-a`,
  };
  for (const side of new Set([ups.a, ups.b]))
    asm.floorItem(floorId, {
      id: side,
      kind: "ups",
      name: `UPS-DC${b}-${f}F-${side.endsWith("-b") ? "B" : "A"}`,
      modelId: UPS_MODEL,
    });
  for (let r = 0; r < spec.roomsPerFloor; r++) {
    const letter = ROOM_LETTERS[r] as string;
    buildRoom({
      asm,
      catalog,
      rng: rng.fork(`${floorId}-${letter}`),
      spec,
      floorId,
      roomId: `${floorId}-${letter.toLowerCase()}`,
      roomName: `${f}F-${letter} 서버룸`,
      host: `${preset.code}${b}-${f}${letter.toLowerCase()}`,
      ups,
      vcenter,
    });
  }
}
