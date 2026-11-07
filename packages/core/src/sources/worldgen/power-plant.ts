/**
 * The power plant behind a floor's UPS, as far as a power choice goes (REQ-107, ADR-0130): spare UPS modules, a transfer
 * switch and diesel generators per side with the fuel the choice keeps on site, and a substation of its own in front of them.
 * `generate.ts` calls this once per floor and side.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { BlueprintAssembler } from "@terrarium/core/sources";
import type { PlantSpec } from "./dense";

const ATS_MODEL = "sy-ats-1600a";
const TRANSFORMER_MODEL = "sy-transformer-2500kva";
/** Share of a generator planned to be used. */
const GEN_SHARE = 0.8;
/** Hours of fuel that the physics burns at the planned share. */
const BURN_SHARE = 0.8;

export interface PlantWhere {
  readonly siteId: string;
  readonly building: string;
  readonly floorId: string;
  readonly side: "a" | "b";
  readonly tag: string;
  /** The load of the floor, W (one side carries it all when the other is lost). */
  readonly loadW: number;
  /** The id of the substation of the world, if its power choice builds one. */
  readonly substation?: string;
}

function generatorModel(loadW: number): string {
  if (loadW <= 800_000) return "tg-diesel-1mw";
  return loadW <= 1_600_000 ? "tg-diesel-2mw" : "tg-diesel-3mw";
}

/** An ATS with the side's UPS modules behind it, a utility source and the generators; returns nothing, it only wires. */
export function plantSide(
  site: { readonly asm: BlueprintAssembler; readonly catalog: Catalog },
  where: PlantWhere,
  plant: PlantSpec,
  upsIds: readonly string[],
): void {
  if (!plant.generator) return;
  const { asm, catalog } = site;
  const { side } = where;
  const ats = `${where.floorId}-ats-${side}`;
  asm.floorItem(where.floorId, {
    id: ats,
    kind: "power_panel",
    name: `ATS-${where.tag}-${side.toUpperCase()}`,
    modelId: ATS_MODEL,
  });
  for (const ups of upsIds) asm.link("power", ups, ats);
  if (where.substation) asm.link("power", ats, where.substation);
  else {
    const tr = `${where.floorId}-tr-${side}`;
    asm.yardItem(
      where.siteId,
      `${where.tag} 수전·변압기`,
      {
        id: tr,
        kind: "power_panel",
        name: `TR-${where.tag}-${side.toUpperCase()}`,
        modelId: TRANSFORMER_MODEL,
        props: { side },
      },
      where.building,
    );
    asm.link("power", ats, tr);
  }
  const model = generatorModel(where.loadW);
  const cap = GEN_SHARE * catalog.getOf(model, "generator").capacityKw * 1000;
  const need = Math.max(1, Math.ceil(where.loadW / cap));
  const count = need + (plant.spareGenerator ? 1 : 0);
  const burn = catalog.getOf(model, "generator").burnLitresPerHour;
  for (let i = 0; i < count; i++) {
    const id = `${where.floorId}-gen-${side}${i + 1}`;
    asm.yardItem(
      where.siteId,
      `${where.tag} 발전기`,
      {
        id,
        kind: "generator",
        name: `GEN-${where.tag}-${side.toUpperCase()}${i + 1}${plant.spareGenerator && i === count - 1 ? "(예비)" : ""}`,
        modelId: model,
        props: {
          side,
          ...(plant.fuelHours
            ? { fuelLitres: Math.round(burn * BURN_SHARE * plant.fuelHours) }
            : {}),
        },
      },
      where.building,
    );
    asm.link("power", ats, id);
  }
}

/** The own substation of a world: two transformers on two utility feeds, sized so one transformer carries it all. */
export function substationOf(
  asm: BlueprintAssembler,
  id: string,
  name: string,
  loadW: number,
): void {
  asm.virtual(id, "substation", name, {
    capacityKw: Math.max(500, Math.ceil((loadW * 1.25) / 1000)),
  });
}
