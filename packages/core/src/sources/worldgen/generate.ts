/**
 * worldgen (REQ-009, REQ-035): a deterministic world from a site preset and size parameters.
 * Same spec and seed, same world. Layout and geometry come from the shared assembler (ADR-0008).
 */
import { Catalog } from "@terrarium/core/catalog";
import { InvalidValueError, SeededRng } from "@terrarium/core/kernel";
import { type AssemblyResult, BlueprintAssembler } from "@terrarium/core/sources";
import type { EntityKind } from "@terrarium/core/world";
import { plantFor } from "./cool-plant";
import { plantSide, substationOf } from "./power-plant";
import { buildRoom, type RoomPower, unitsFor } from "./room";
import { withServices } from "./services";
import { type SitePreset, sitePreset, specProblems, type WorldgenSpec } from "./spec";

export interface WorldgenResult extends AssemblyResult {
  readonly stats: Readonly<Partial<Record<EntityKind, number>>>;
}

const ROOM_LETTERS = "ABCD";
const UPS_MODEL = "ups-500kva";
const substationId = (code: string): string => `${code}-sub`;

export function generateWorld(
  spec: WorldgenSpec,
  catalog: Catalog = new Catalog(),
): WorldgenResult {
  const problems = specProblems(spec);
  if (problems.length > 0)
    throw new InvalidValueError(`세계를 만들 수 없어요: ${problems.join("; ")}`);
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
  let plantW = 0;
  const site: SiteContext = { asm, catalog, rng, spec, preset, vcenter, rooms: 0 };
  for (let b = 1; b <= spec.buildings; b++) {
    const buildingId = `${preset.code}-dc${b}`;
    asm.building(buildingId, preset.code, `DC${b}동`);
    for (let f = 1; f <= spec.floors; f++) plantW += addFloor(site, buildingId, b, f);
  }
  if (spec.plant?.substation)
    substationOf(asm, substationId(preset.code), `${preset.name} 변전소`, plantW);
  const built = asm.build();
  const result = { ...built, blueprint: withServices(built.blueprint) };
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
  /** Rooms built so far, to spread the plain compute racks of a counted world over them. */
  rooms: number;
}

/** Plain compute racks of the room that comes `k`-th of `rooms`: an even share, the first rooms taking the rest. */
const shareOf = (total: number, rooms: number, k: number): number =>
  Math.floor(total / rooms) + (k < total % rooms ? 1 : 0);

/** Builds one floor; returns the electric load of its rooms, W. */
function addFloor(site: SiteContext, buildingId: string, b: number, f: number): number {
  const { asm, catalog, rng, spec, preset, vcenter } = site;
  const floorId = `${buildingId}-f${f}`;
  asm.floor(floorId, buildingId, `${f}F`, f);
  const rooms: RoomPower[] = [];
  for (let r = 0; r < spec.roomsPerFloor; r++) {
    const letter = ROOM_LETTERS[r] as string;
    rooms.push(
      buildRoom({
        asm,
        catalog,
        rng: rng.fork(`${floorId}-${letter}`),
        spec,
        floorId,
        roomId: `${floorId}-${letter.toLowerCase()}`,
        roomName: `${f}F-${letter} 서버룸`,
        host: `${preset.code}${b}-${f}${letter.toLowerCase()}`,
        vcenter,
        ...(spec.dense && b === 1 && f === 1 && r === 0 ? { dense: spec.dense } : {}),
        ...(spec.computeRacks !== undefined
          ? {
              computeRacks: shareOf(
                spec.computeRacks,
                spec.buildings * spec.floors * spec.roomsPerFloor,
                site.rooms,
              ),
            }
          : {}),
      }),
    );
    site.rooms += 1;
  }
  powerFloor({ asm, catalog, spec, preset }, { floorId, buildingId, b, f }, rooms);
  const tag = `DC${b}`;
  for (const room of rooms)
    plantFor(
      { asm, catalog },
      { siteId: preset.code, building: buildingId, tag },
      room.cdus,
      room.liquidKw,
    );
  return rooms.reduce((sum, room) => sum + room.loadW, 0);
}

/**
 * The UPS of a floor: enough per side that one side alone could carry every room of the floor, and
 * every room panel hangs on one of them (spread evenly). A small floor has one UPS per side.
 */
function powerFloor(
  site: Pick<SiteContext, "asm" | "catalog" | "spec" | "preset">,
  where: {
    readonly floorId: string;
    readonly buildingId: string;
    readonly b: number;
    readonly f: number;
  },
  rooms: readonly RoomPower[],
): void {
  const { asm, catalog, spec } = site;
  const load = rooms.reduce((sum, room) => sum + room.loadW, 0);
  const plant = spec.plant;
  const perSide =
    unitsFor(load, catalog.getOf(UPS_MODEL, "ups").capacityKw * 1000) + (plant?.upsSpare ? 1 : 0);
  const sides = spec.powerRedundancy === "2N" ? (["a", "b"] as const) : (["a"] as const);
  for (const side of sides) {
    const ids = Array.from({ length: perSide }, (_, i) => {
      const id = `${where.floorId}-ups-${side}${i === 0 ? "" : i + 1}`;
      asm.floorItem(where.floorId, {
        id,
        kind: "ups",
        name: `UPS-DC${where.b}-${where.f}F-${side.toUpperCase()}${i === 0 ? "" : i + 1}`,
        modelId: UPS_MODEL,
      });
      return id;
    });
    rooms
      .flatMap((room) => room.panels[side])
      .forEach((panel, i) => {
        // N+1 modules share every panel of the side; plain UPS units each take their own panels
        if (plant?.upsSpare) for (const id of ids) asm.link("power", panel, id);
        else asm.link("power", panel, ids[i % ids.length] as string);
      });
    if (plant)
      plantSide(
        { asm, catalog },
        {
          siteId: site.preset.code,
          building: where.buildingId,
          floorId: where.floorId,
          side,
          tag: `DC${where.b}-${where.f}F`,
          loadW: load,
          ...(plant.substation ? { substation: substationId(site.preset.code) } : {}),
        },
        plant,
        ids,
      );
  }
}
